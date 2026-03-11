import type { Escalation } from "@edgebric/types";

/** Send an escalation as a Slack DM to a specific user via Bot Token + chat.postMessage. */
export async function sendSlackDM(
  botToken: string,
  slackUserId: string,
  escalation: Escalation,
  conversationUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  const citationLines = escalation.sourceCitations
    .slice(0, 3)
    .map((c) => `• ${c.documentName}${c.pageNumber > 0 ? ` (p. ${c.pageNumber})` : ""}`)
    .join("\n");

  const truncatedAnswer = escalation.aiAnswer.slice(0, 500) + (escalation.aiAnswer.length > 500 ? "…" : "");

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: "Verification Request", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Employee question:*\n>${escalation.question}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*AI answer:*\n${truncatedAnswer}`,
      },
    },
    ...(citationLines
      ? [{ type: "section", text: { type: "mrkdwn", text: `*Sources cited:*\n${citationLines}` } }]
      : []),
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View Conversation", emoji: true },
          url: conversationUrl,
          style: "primary",
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Escalation \`${escalation.id}\` | ${new Date(escalation.createdAt).toISOString()}`,
        },
      ],
    },
  ];

  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify({
        channel: slackUserId,
        text: `Verification Request: ${escalation.question}`,
        blocks,
      }),
    });

    const data = (await res.json()) as { ok: boolean; error?: string };
    if (!data.ok) {
      return { ok: false, error: data.error ?? `Slack API error` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

/** Validate a Slack Bot Token by calling auth.test. */
export async function testSlackBot(
  botToken: string,
): Promise<{ ok: boolean; error?: string; teamName?: string }> {
  try {
    const res = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
    });

    const data = (await res.json()) as { ok: boolean; error?: string; team?: string };
    if (!data.ok) {
      return { ok: false, error: data.error ?? "Invalid token" };
    }
    const result: { ok: boolean; error?: string; teamName?: string } = { ok: true };
    if (data.team) result.teamName = data.team;
    return result;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" };
  }
}
