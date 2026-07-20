import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { ulid } from "ulid";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const PARENTS_TABLE = process.env.PARENTS_TABLE || "homework-bot-parents";
const CHILDREN_TABLE = process.env.CHILDREN_TABLE || "homework-bot-children";

export interface Parent {
  line_user_id: string;
  family_id: string;
  display_name: string;
  created_at: string;
}

export interface Child {
  child_id: string;
  family_id: string;
  nickname: string;
  current_grade: number;
  current_unit_order: number;
  created_at: string;
}

export async function getParent(lineUserId: string): Promise<Parent | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: PARENTS_TABLE,
      Key: { line_user_id: lineUserId },
    })
  );
  return (result.Item as Parent) || null;
}

export async function createParent(lineUserId: string, displayName: string, familyId?: string): Promise<Parent> {
  const parent: Parent = {
    line_user_id: lineUserId,
    family_id: familyId || ulid(),
    display_name: displayName,
    created_at: new Date().toISOString(),
  };

  await docClient.send(
    new PutCommand({
      TableName: PARENTS_TABLE,
      Item: parent,
    })
  );

  return parent;
}

export async function getChildrenByFamily(familyId: string): Promise<Child[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: CHILDREN_TABLE,
      IndexName: "family-index",
      KeyConditionExpression: "family_id = :fid",
      ExpressionAttributeValues: { ":fid": familyId },
    })
  );
  return (result.Items as Child[]) || [];
}

export async function getChild(childId: string): Promise<Child | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: CHILDREN_TABLE,
      Key: { child_id: childId },
    })
  );
  return (result.Item as Child) || null;
}

export async function createChild(familyId: string, nickname: string): Promise<Child> {
  const child: Child = {
    child_id: ulid(),
    family_id: familyId,
    nickname,
    current_grade: 1,
    current_unit_order: 1,
    created_at: new Date().toISOString(),
  };

  await docClient.send(
    new PutCommand({
      TableName: CHILDREN_TABLE,
      Item: child,
    })
  );

  return child;
}

export async function findChildByNickname(familyId: string, nickname: string): Promise<Child | undefined> {
  const children = await getChildrenByFamily(familyId);
  return children.find((c) => c.nickname === nickname || c.nickname.includes(nickname));
}

export async function updateChildUnit(childId: string, unitOrder: number, grade?: number): Promise<void> {
  const updateExpr = grade
    ? "SET current_unit_order = :u, current_grade = :g"
    : "SET current_unit_order = :u";
  const exprValues: Record<string, unknown> = { ":u": unitOrder };
  if (grade) exprValues[":g"] = grade;

  await docClient.send(
    new UpdateCommand({
      TableName: CHILDREN_TABLE,
      Key: { child_id: childId },
      UpdateExpression: updateExpr,
      ExpressionAttributeValues: exprValues,
    })
  );
}
