import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { validateSignature, WebhookEvent, TextMessage, Client, MessageAPIResponseBase } from "@line/bot-sdk";
import { parseCommand, isModificationInstruction, parseTextAnswers } from "./command-parser";
import { getUserState, createOrUpdateState, setLastPrintId, clearWaitingState } from "../shared/state";
import { getParent, createParent, getChildrenByFamily, createChild, findChildByNickname } from "../shared/family";

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || "";
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";

const lineClient = new Client({
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: LINE_CHANNEL_SECRET,
});

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // Verify LINE signature
  const signature = event.headers["x-line-signature"] || event.headers["X-Line-Signature"] || "";
  const body = event.body || "";

  if (!validateSignature(body, LINE_CHANNEL_SECRET, signature)) {
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
      // TODO: Call Grading Agent with text answers
      await clearWaitingState(userId);
      await replyText(replyToken, "テキスト回答を受け付けました。採点中...");
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
        state!.active_child_id = firstChild.child_id;
      }
      // TODO: Call Print Generator Agent
      await replyText(replyToken, "プリントを作成中... 📝");
      break;
    }

    case "history": {
      // TODO: Call learning summary
      await replyText(replyToken, "学習りれきを取得中...");
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
      if (state?.last_print_id && isModificationInstruction(text)) {
        // TODO: Call Print Generator Agent for regeneration
        await replyText(replyToken, "プリントを修正中... ✏️");
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

  // TODO: Download image from LINE, upload to S3, call Grading Agent
  await replyText(replyToken, "回答を採点中... ✅");
}

async function replyText(replyToken: string, text: string): Promise<MessageAPIResponseBase> {
  return lineClient.replyMessage(replyToken, { type: "text", text });
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
