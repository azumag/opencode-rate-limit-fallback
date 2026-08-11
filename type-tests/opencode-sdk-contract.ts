import type {
  AppLogData,
  Event,
  SessionPromptAsyncData,
  UserMessage,
} from "@opencode-ai/sdk";

type Assert<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? (<T>() => T extends B ? 1 : 2) extends
      (<T>() => T extends A ? 1 : 2)
      ? true
      : false
    : false;

type SessionCreatedEvent = Extract<Event, { type: "session.created" }>;
type SessionCreatedInfo = SessionCreatedEvent["properties"]["info"];
type PromptAsyncBody = NonNullable<SessionPromptAsyncData["body"]>;
type AppLogBody = NonNullable<AppLogData["body"]>;

export type OpenCodeSdkContractAssertions = [
  Assert<IsNever<SessionCreatedEvent> extends false ? true : false>,
  Assert<IsNever<PromptAsyncBody> extends false ? true : false>,
  Assert<IsNever<AppLogBody> extends false ? true : false>,
  Assert<IsEqual<UserMessage["agent"], string>>,
  Assert<IsEqual<PromptAsyncBody["agent"], UserMessage["agent"] | undefined>>,
  Assert<"parentID" extends keyof SessionCreatedInfo ? true : false>,
  Assert<IsEqual<SessionCreatedInfo["parentID"], string | undefined>>,
];

export const sessionCreatedFixture = {
  type: "session.created",
  properties: {
    info: {
      id: "child-session",
      projectID: "project",
      directory: "/workspace",
      parentID: "root-session",
      title: "Child session",
      version: "1.18.16",
      time: {
        created: 0,
        updated: 0,
      },
    },
  },
} satisfies SessionCreatedEvent;

export const promptAsyncFixture = {
  body: {
    agent: "build",
    parts: [],
  },
  path: {
    id: "session",
  },
  url: "/session/{id}/prompt_async",
} satisfies SessionPromptAsyncData;

export const appLogFixture = {
  body: {
    service: "opencode-rate-limit-fallback",
    level: "info",
    message: "SDK contract check",
    extra: {
      source: "type-test",
    },
  },
  url: "/log",
} satisfies AppLogData;
