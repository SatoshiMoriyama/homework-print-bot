import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.USER_STATE_TABLE || "homework-bot-user-state";

export interface UserState {
  line_user_id: string;
  active_child_id: string | null;
  last_print_id: string | null;
  waiting_for_text_answer: boolean;
  pending_questions: number[];
  updated_at: string;
}

export async function getUserState(lineUserId: string): Promise<UserState | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { line_user_id: lineUserId },
    })
  );
  return (result.Item as UserState) || null;
}

export async function createOrUpdateState(state: Partial<UserState> & { line_user_id: string }): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        ...state,
        updated_at: new Date().toISOString(),
      },
    })
  );
}

export async function updateActiveChild(lineUserId: string, childId: string): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { line_user_id: lineUserId },
      UpdateExpression: "SET active_child_id = :cid, updated_at = :now",
      ExpressionAttributeValues: {
        ":cid": childId,
        ":now": new Date().toISOString(),
      },
    })
  );
}

export async function setWaitingForTextAnswer(
  lineUserId: string,
  printId: string,
  pendingQuestions: number[]
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { line_user_id: lineUserId },
      UpdateExpression:
        "SET waiting_for_text_answer = :w, last_print_id = :pid, pending_questions = :pq, updated_at = :now",
      ExpressionAttributeValues: {
        ":w": true,
        ":pid": printId,
        ":pq": pendingQuestions,
        ":now": new Date().toISOString(),
      },
    })
  );
}

export async function clearWaitingState(lineUserId: string): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { line_user_id: lineUserId },
      UpdateExpression: "SET waiting_for_text_answer = :w, pending_questions = :pq, updated_at = :now",
      ExpressionAttributeValues: {
        ":w": false,
        ":pq": [],
        ":now": new Date().toISOString(),
      },
    })
  );
}

export async function setLastPrintId(lineUserId: string, printId: string): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { line_user_id: lineUserId },
      UpdateExpression: "SET last_print_id = :pid, updated_at = :now",
      ExpressionAttributeValues: {
        ":pid": printId,
        ":now": new Date().toISOString(),
      },
    })
  );
}
