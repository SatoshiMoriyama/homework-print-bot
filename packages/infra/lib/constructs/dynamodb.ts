import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

export interface Tables {
  parents: dynamodb.Table;
  children: dynamodb.Table;
  prints: dynamodb.Table;
  gradingResults: dynamodb.Table;
  learningStats: dynamodb.Table;
  userState: dynamodb.Table;
}

export class DynamoDbConstruct extends Construct {
  public readonly tables: Tables;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const parents = new dynamodb.Table(this, "ParentsTable", {
      tableName: "homework-bot-parents",
      partitionKey: { name: "line_user_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const children = new dynamodb.Table(this, "ChildrenTable", {
      tableName: "homework-bot-children",
      partitionKey: { name: "child_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    children.addGlobalSecondaryIndex({
      indexName: "family-index",
      partitionKey: { name: "family_id", type: dynamodb.AttributeType.STRING },
    });

    const prints = new dynamodb.Table(this, "PrintsTable", {
      tableName: "homework-bot-prints",
      partitionKey: { name: "print_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    prints.addGlobalSecondaryIndex({
      indexName: "child-index",
      partitionKey: { name: "child_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "created_at", type: dynamodb.AttributeType.STRING },
    });

    const gradingResults = new dynamodb.Table(this, "GradingResultsTable", {
      tableName: "homework-bot-grading-results",
      partitionKey: { name: "result_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    gradingResults.addGlobalSecondaryIndex({
      indexName: "child-index",
      partitionKey: { name: "child_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "graded_at", type: dynamodb.AttributeType.STRING },
    });
    gradingResults.addGlobalSecondaryIndex({
      indexName: "print-index",
      partitionKey: { name: "print_id", type: dynamodb.AttributeType.STRING },
    });

    const learningStats = new dynamodb.Table(this, "LearningStatsTable", {
      tableName: "homework-bot-learning-stats",
      partitionKey: { name: "child_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "subcategory", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const userState = new dynamodb.Table(this, "UserStateTable", {
      tableName: "homework-bot-user-state",
      partitionKey: { name: "line_user_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.tables = { parents, children, prints, gradingResults, learningStats, userState };
  }
}
