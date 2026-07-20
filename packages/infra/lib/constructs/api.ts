import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { Tables } from "./dynamodb";

export interface ApiConstructProps {
  tables: Tables;
  bucket: s3.Bucket;
}

export class ApiConstruct extends Construct {
  public readonly webhookHandler: nodejs.NodejsFunction;
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiConstructProps) {
    super(scope, id);

    // LINE Webhook Lambda
    this.webhookHandler = new nodejs.NodejsFunction(this, "WebhookHandler", {
      functionName: "homework-bot-webhook-handler",
      entry: "../../packages/functions/src/webhook/handler.ts",
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment: {
        PARENTS_TABLE: props.tables.parents.tableName,
        CHILDREN_TABLE: props.tables.children.tableName,
        PRINTS_TABLE: props.tables.prints.tableName,
        GRADING_RESULTS_TABLE: props.tables.gradingResults.tableName,
        LEARNING_STATS_TABLE: props.tables.learningStats.tableName,
        USER_STATE_TABLE: props.tables.userState.tableName,
        BUCKET_NAME: props.bucket.bucketName,
        LINE_CHANNEL_SECRET: process.env.LINE_CHANNEL_SECRET || "",
        LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN || "",
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    // Grant permissions
    Object.values(props.tables).forEach((table) => {
      table.grantReadWriteData(this.webhookHandler);
    });
    props.bucket.grantReadWrite(this.webhookHandler);

    // Bedrock permissions
    this.webhookHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: ["*"],
      })
    );

    // API Gateway
    this.api = new apigateway.RestApi(this, "WebhookApi", {
      restApiName: "homework-print-bot-api",
      description: "LINE Webhook API for homework-print-bot",
    });

    const webhook = this.api.root.addResource("webhook");
    webhook.addMethod("POST", new apigateway.LambdaIntegration(this.webhookHandler));
  }
}
