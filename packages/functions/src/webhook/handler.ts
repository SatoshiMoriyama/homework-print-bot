import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { validateSignature, WebhookEvent, TextMessage, Client, MessageAPIResponseBase } from "@line/bot-sdk";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { parseCommand, isModificationInstruction, parseTextAnswers } from "./command-parser";
import { getUserState, createOrUpdateState, setLastPrintId, clearWaitingState } from "../shared/state";
import { getParent, createParent, getChildrenByFamily, createChild, findChildByNickname } from "../shared/family";
import { invokeAgent } from "../shared/agentcore";
import { getPresignedUrl } from "../shared/s3";
import { invokeRenderer } from "../shared/renderer";

const LINE_CHANNEL_SECRET_PARAM = process.env.LINE_CHANNEL_SECRET_PARAM;
const LINE_CHANNEL_ACCESS_TOKEN_PARAM = process.env.LINE_CHANNEL_ACCESS_TOKEN_PARAM;
// SSM client and secret cache (cold start only)
const ssmClient = new SSMClient({});
const s3Client = new S3Client({});
let cachedChannelSecret: string | undefined;
let cachedChannelAccessToken: string | undefined;

async function getSSMParameter(paramName: string | undefined, envVarName: string): Promise<string> {
  if (!paramName) {
    throw new Error(`Environment variable "${envVarName}" is not configured (SSM parameter name is missing)`);
  }
  const res = await ssmClient.send(
    new GetParameterCommand({ Name: paramName, WithDecryption: true })
  );
  const value = res.Parameter?.Value;
  if (!value) {
    throw new Error(`SSM parameter "${paramName}" (from ${envVarName}) returned empty value`);
  }
  return value;
}

async function getSecrets(): Promise<{ channelSecret: string; channelAccessToken: string }> {
  if (cachedChannelSecret === undefined) {
    cachedChannelSecret = await getSSMParameter(LINE_CHANNEL_SECRET_PARAM, "LINE_CHANNEL_SECRET_PARAM");
  }
  if (cachedChannelAccessToken === undefined) {
    cachedChannelAccessToken = await getSSMParameter(LINE_CHANNEL_ACCESS_TOKEN_PARAM, "LINE_CHANNEL_ACCESS_TOKEN_PARAM");
  }
  return { channelSecret: cachedChannelSecret, channelAccessToken: cachedChannelAccessToken };
}

let lineClient: Client | undefined;

async function getLineClient(): Promise<Client> {
  if (!lineClient) {
    const { channelSecret, channelAccessToken } = await getSecrets();
    lineClient = new Client({
      channelAccessToken,
      channelSecret,
    });
  }
  return lineClient;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { channelSecret } = await getSecrets();

  // Verify LINE signature
  const signature = event.headers["x-line-signature"] || event.headers["X-Line-Signature"] || "";
  const body = event.body || "";

  if (!validateSignature(body, channelSecret, signature)) {
    return { statusCode: 403, body: "Invalid signature" };
  }

  const webhookBody = JSON.parse(body);
  const events: WebhookEvent[] = webhookBody.events || [];

  for (const webhookEvent of events) {
    await handleEvent(webhookEvent);
  }

  return { statusCode: 200, body: "OK" };
}

async function handleEvent(event: WebhookEvent): Promise<void> {
  if (event.type !== "message") return;

  const userId = event.source.userId;
  if (!userId) return;

  // Ensure parent exists
  let parent = await getParent(userId);
  if (!parent) {
    parent = await createParent(userId, "Parent");
    // Initialize user state
    await createOrUpdateState({
      line_user_id: userId,
      active_child_id: null,
      last_print_id: null,
      waiting_for_text_answer: false,
      pending_questions: [],
    });
    // Send welcome message
    await replyText(event.replyToken, WELCOME_MESSAGE);
    return;
  }

  const state = await getUserState(userId);

  if (event.message.type === "text") {
    await handleTextMessage(event.replyToken, userId, event.message.text, parent.family_id, state);
  } else if (event.message.type === "image") {
    await handleImageMessage(event.replyToken, userId, event.message.id, state);
  }
}

async function handleTextMessage(
  replyToken: string,
  userId: string,
  text: string,
  familyId: string,
  state: Awaited<ReturnType<typeof getUserState>>
): Promise<void> {
  // If waiting for text answer, process it
  if (state?.waiting_for_text_answer && state.last_print_id) {
    const textAnswers = parseTextAnswers(text);
    if (textAnswers.length > 0) {
      await replyText(replyToken, "テキスト回答を受け付けました。採点中...");
      try {
        const result = await invokeAgent({
          action: "grade_text_answer",
          child_id: state.active_child_id!,
          print_id: state.last_print_id,
          text_answers: textAnswers.map((a) => ({ question_number: a.questionNumber, answer_text: a.answerText })),
        }, userId);
        await clearWaitingState(userId);
        if (result.error) {
          await pushText(userId, `採点エラー: ${result.error}`);
        } else {
          const score = result.score as number;
          const total = result.total as number;
          await pushText(userId, `採点完了！ ${score}/${total} 問正解 🎉\n\n「プリント」で次の問題を出すよ。`);
        }
      } catch (err) {
        console.error("AgentCore invoke error (grade_text_answer):", err);
        await pushText(userId, "採点中にエラーが発生しました。もう一度送ってね。");
      }
      return;
    }
  }

  // Get registered children for nickname matching
  const children = await getChildrenByFamily(familyId);
  const childNames = children.map((c) => c.nickname);

  const command = parseCommand(text, childNames);

  switch (command.type) {
    case "print_request": {
      if (!state?.active_child_id) {
        if (children.length === 0) {
          await replyText(replyToken, "まず子供を登録してね！\n「登録 たろうくん」のように送ってね。");
          return;
        }
        // Auto-select first child
        const firstChild = children[0];
        await createOrUpdateState({ line_user_id: userId, active_child_id: firstChild.child_id, last_print_id: null, waiting_for_text_answer: false, pending_questions: [] });
        if (state) {
          state.active_child_id = firstChild.child_id;
        }
      }
      await replyText(replyToken, "プリントを作成中... 📝");
      // Call Print Generator Agent asynchronously
      try {
        const result = await invokeAgent({
          action: "generate_print",
          child_id: state!.active_child_id!,
        }, userId);
        if (result.error) {
          await pushText(userId, `エラーが発生しました: ${result.error}`);
        } else {
          const printId = result.print_id as string;
          let s3Key = result.s3_key as string;
          await setLastPrintId(userId, printId);
          // If the agent returned HTML (needs rendering), invoke the renderer Lambda
          if (result.needs_rendering) {
            const rendered = await invokeRenderer({ s3Key, bucketName: process.env.BUCKET_NAME || "" });
            s3Key = rendered.pngS3Key;
          }
          await sendPrintImage(userId, s3Key);
        }
      } catch (err) {
        console.error("AgentCore invoke error (generate_print):", err);
        await pushText(userId, "プリント生成中にエラーが発生しました。もう一度試してね。");
      }
      break;
    }

    case "history": {
      if (!state?.active_child_id) {
        await replyText(replyToken, "まず子供を登録してね！");
        return;
      }
      await replyText(replyToken, "学習りれきを取得中...");
      try {
        const result = await invokeAgent({
          action: "get_learning_summary",
          child_id: state.active_child_id,
        }, userId);
        if (result.error) {
          await pushText(userId, `りれき取得エラー: ${result.error}`);
        } else if (result.message) {
          await pushText(userId, result.message as string);
        } else {
          const lines = [
            `📊 学習りれき`,
            ``,
            `正解率: ${result.overall_accuracy}%`,
            `総問題数: ${result.total_problems}問（正解: ${result.total_correct}問）`,
            `現在の単元: ${result.current_unit || "未開始"}`,
            `進捗: ${result.units_completed}/${result.total_units} 単元`,
          ];
          const weak = result.weak_areas as string[];
          if (weak && weak.length > 0) {
            lines.push(``, `苦手: ${weak.join("、")}`);
          }
          const strong = result.strong_areas as string[];
          if (strong && strong.length > 0) {
            lines.push(`得意: ${strong.join("、")}`);
          }
          await pushText(userId, lines.join("\n"));
        }
      } catch (err) {
        console.error("AgentCore invoke error (get_learning_summary):", err);
        await pushText(userId, "りれき取得中にエラーが発生しました。");
      }
      break;
    }

    case "switch_child": {
      const child = await findChildByNickname(familyId, command.childName!);
      if (child) {
        await createOrUpdateState({ line_user_id: userId, active_child_id: child.child_id, last_print_id: null, waiting_for_text_answer: false, pending_questions: [] });
        await replyText(replyToken, `${child.nickname}に切り替えたよ！`);
      } else {
        await replyText(replyToken, `「${command.childName}」は見つからないよ。`);
      }
      break;
    }

    case "register_child": {
      const newChild = await createChild(familyId, command.childName!);
      await createOrUpdateState({ line_user_id: userId, active_child_id: newChild.child_id, last_print_id: null, waiting_for_text_answer: false, pending_questions: [] });
      await replyText(replyToken, `${newChild.nickname}を登録したよ！\n「プリント」と送るとプリントが届くよ 📝`);
      break;
    }

    case "help":
    default: {
      // Check if it's a modification instruction
      if (state?.last_print_id && state.active_child_id && isModificationInstruction(text)) {
        await replyText(replyToken, "プリントを修正中... ✏️");
        try {
          const result = await invokeAgent({
            action: "regenerate_print",
            child_id: state.active_child_id,
            print_id: state.last_print_id,
            modification_instruction: text,
          }, userId);
          if (result.error) {
            await pushText(userId, `修正エラー: ${result.error}`);
          } else {
            const printId = result.print_id as string;
            let s3Key = result.s3_key as string;
            await setLastPrintId(userId, printId);
            // If the agent returned HTML (needs rendering), invoke the renderer Lambda
            if (result.needs_rendering) {
              const rendered = await invokeRenderer({ s3Key, bucketName: process.env.BUCKET_NAME || "" });
              s3Key = rendered.pngS3Key;
            }
            await sendPrintImage(userId, s3Key);
          }
        } catch (err) {
          console.error("AgentCore invoke error (regenerate_print):", err);
          await pushText(userId, "プリント修正中にエラーが発生しました。");
        }
        return;
      }
      await replyText(replyToken, HELP_MESSAGE);
      break;
    }
  }
}

async function handleImageMessage(
  replyToken: string,
  userId: string,
  messageId: string,
  state: Awaited<ReturnType<typeof getUserState>>
): Promise<void> {
  if (!state?.active_child_id) {
    await replyText(replyToken, "まず子供を登録してね！\n「登録 たろうくん」のように送ってね。");
    return;
  }

  if (!state.last_print_id) {
    await replyText(replyToken, "まず「プリント」と送って問題を受け取ってから、回答の写真を送ってね。");
    return;
  }

  await replyText(replyToken, "回答を採点中... ✅");

  try {
    // Download image from LINE
    const client = await getLineClient();
    const stream = await client.getMessageContent(messageId);
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    const imageBuffer = Buffer.concat(chunks);

    // Upload to S3
    const s3Key = `answers/${state.active_child_id}/${messageId}.jpg`;
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.BUCKET_NAME || "",
      Key: s3Key,
      Body: imageBuffer,
      ContentType: "image/jpeg",
    }));

    // Call Grading Agent
    const result = await invokeAgent({
      action: "grade_answer",
      child_id: state.active_child_id,
      print_id: state.last_print_id,
      answer_image_s3_key: s3Key,
    }, userId);

    if (result.error) {
      await pushText(userId, `採点エラー: ${result.error}`);
    } else if (result.status === "partial") {
      const unreadable = (result.unreadable_questions as number[]) || [];
      await pushText(userId, `一部読み取れない問題がありました（${unreadable.join(", ")}番）。\nテキストで回答を送ってね。\n例: ①3+5=8 ②2+4=6`);
      await createOrUpdateState({
        line_user_id: userId,
        active_child_id: state.active_child_id,
        last_print_id: state.last_print_id,
        waiting_for_text_answer: true,
        pending_questions: unreadable,
      });
    } else {
      const score = result.score as number;
      const total = result.total as number;
      await pushText(userId, `採点完了！ ${score}/${total} 問正解 🎉\n\n「プリント」で次の問題を出すよ。`);
    }
  } catch (err) {
    console.error("AgentCore invoke error (grade_answer):", err);
    await pushText(userId, "採点中にエラーが発生しました。もう一度写真を送ってね。");
  }
}

async function replyText(replyToken: string, text: string): Promise<MessageAPIResponseBase> {
  const client = await getLineClient();
  return client.replyMessage(replyToken, { type: "text", text });
}

async function pushText(userId: string, text: string): Promise<void> {
  const client = await getLineClient();
  await client.pushMessage(userId, { type: "text", text });
}

export async function sendPrintImage(userId: string, s3Key: string): Promise<void> {
  const bucketName = process.env.BUCKET_NAME || "";
  if (!bucketName) {
    throw new Error('Environment variable "BUCKET_NAME" is not configured');
  }
  try {
    const presignedUrl = await getPresignedUrl(bucketName, s3Key);
    const client = await getLineClient();
    await client.pushMessage(userId, {
      type: "image",
      originalContentUrl: presignedUrl,
      previewImageUrl: presignedUrl,
    });
  } catch (error) {
    console.error("Failed to send print image", { userId, s3Key, error });
    throw error;
  }
}

const WELCOME_MESSAGE = `ようこそ！しゅくだいプリントBotだよ 📝

つかいかた：
1. まず「登録 ○○くん」で子供を登録してね
2. 「プリント」と送るとプリントが届くよ
3. 回答を写真で送ると採点するよ
4. 「りれき」で学習きろくが見れるよ`;

const HELP_MESSAGE = `つかいかた：
・「プリント」→ がくしゅうプリント
・「りれき」→ がくしゅうのきろく
・「登録 ○○くん」→ 子供の登録
・写真を送る → 回答の採点`;
