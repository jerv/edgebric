import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatClient } from "../services/chatClient.js";

describe("chatClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("merges later system messages into the leading system message before inference", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "ok",
            },
          },
        ],
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = createChatClient();
    await client.chatComplete([
      { role: "system", content: "System A" },
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
      { role: "system", content: "System B" },
      { role: "user", content: "Second question" },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as {
      messages: Array<{ role: string; content: string | null }>;
    };

    expect(body.messages).toEqual([
      { role: "system", content: "System A\n\nSystem B" },
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Second question /nothink" },
    ]);
  });
});
