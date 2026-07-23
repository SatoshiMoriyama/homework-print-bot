import * as agentcore from "aws-cdk-lib/aws-bedrockagentcore";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as path from "path";
import { Construct } from "constructs";
import { Tables } from "./dynamodb";

export interface AgentCoreConstructProps {
  tables: Tables;
  bucket: s3.Bucket;
  webhookHandler: lambda.Function;
}

export class AgentCoreConstruct extends Construct {
  public readonly runtime: agentcore.Runtime;

  constructor(scope: Construct, id: string, props: AgentCoreConstructProps) {
    super(scope, id);

    const artifact = agentcore.AgentRuntimeArtifact.fromCodeAsset({
      path: path.join(__dirname, "../../../agent"),
      runtime: agentcore.AgentCoreRuntime.PYTHON_3_12,
      entrypoint: ["entrypoint.py"],
    });

    this.runtime = new agentcore.Runtime(this, "HomeworkPrintBot", {
      runtimeName: "HomeworkPrintBot",
      agentRuntimeArtifact: artifact,
      environmentVariables: {
        CHILDREN_TABLE: props.tables.children.tableName,
        PRINTS_TABLE: props.tables.prints.tableName,
        GRADING_RESULTS_TABLE: props.tables.gradingResults.tableName,
        LEARNING_STATS_TABLE: props.tables.learningStats.tableName,
        BUCKET_NAME: props.bucket.bucketName,
        BEDROCK_MODEL_ID: "global.anthropic.claude-sonnet-5",
      },
    });

    // Grant Bedrock model invocation permissions
    this.runtime.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ],
        resources: ["*"],
      })
    );

    // Grant DynamoDB read/write access to tables used by the agent
    props.tables.children.grantReadWriteData(this.runtime.role);
    props.tables.prints.grantReadWriteData(this.runtime.role);
    props.tables.gradingResults.grantReadWriteData(this.runtime.role);
    props.tables.learningStats.grantReadWriteData(this.runtime.role);

    // Grant S3 read/write access
    props.bucket.grantReadWrite(this.runtime.role);

    // Grant the webhook Lambda permission to invoke this runtime
    this.runtime.grantInvoke(props.webhookHandler);

    // Pass the runtime ARN to the webhook Lambda so it can invoke the runtime
    props.webhookHandler.addEnvironment(
      "AGENTCORE_RUNTIME_ARN",
      this.runtime.agentRuntimeArn
    );
  }
}
