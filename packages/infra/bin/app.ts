#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { HomeworkPrintBotStack } from "../lib/stacks/homework-print-bot-stack";

const app = new cdk.App();

new HomeworkPrintBotStack(app, "HomeworkPrintBotStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "ap-northeast-1",
  },
});
