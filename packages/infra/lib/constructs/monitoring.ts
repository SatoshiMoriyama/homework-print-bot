import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as sns from "aws-cdk-lib/aws-sns";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as cw_actions from "aws-cdk-lib/aws-cloudwatch-actions";
import { Construct } from "constructs";

export interface MonitoringConstructProps {
  webhookHandler: lambda.IFunction;
}

export class MonitoringConstruct extends Construct {
  constructor(scope: Construct, id: string, props: MonitoringConstructProps) {
    super(scope, id);

    // SNS Topic for alerts
    const alertTopic = new sns.Topic(this, "AlertTopic", {
      topicName: "homework-bot-alerts",
    });

    // Lambda error rate alarm
    const errorAlarm = new cloudwatch.Alarm(this, "LambdaErrorAlarm", {
      alarmName: "homework-bot-lambda-errors",
      metric: props.webhookHandler.metricErrors({
        period: cdk.Duration.minutes(5),
      }),
      threshold: 3,
      evaluationPeriods: 1,
      alarmDescription: "Lambda error count >= 3 in 5 minutes",
    });
    errorAlarm.addAlarmAction(new cw_actions.SnsAction(alertTopic));

    // Lambda timeout alarm
    const timeoutAlarm = new cloudwatch.Alarm(this, "LambdaTimeoutAlarm", {
      alarmName: "homework-bot-lambda-timeout",
      metric: props.webhookHandler.metricDuration({
        period: cdk.Duration.minutes(5),
        statistic: "Maximum",
      }),
      threshold: 55000, // 55 seconds (timeout is 60s)
      evaluationPeriods: 1,
      alarmDescription: "Lambda near timeout",
    });
    timeoutAlarm.addAlarmAction(new cw_actions.SnsAction(alertTopic));

    // Dashboard
    new cloudwatch.Dashboard(this, "Dashboard", {
      dashboardName: "homework-print-bot",
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: "Lambda Invocations & Errors",
            left: [props.webhookHandler.metricInvocations()],
            right: [props.webhookHandler.metricErrors()],
          }),
          new cloudwatch.GraphWidget({
            title: "Lambda Duration",
            left: [props.webhookHandler.metricDuration()],
          }),
        ],
      ],
    });
  }
}
