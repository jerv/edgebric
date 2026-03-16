import readline from "readline";

/** Prompt the user for input with a default value. */
export async function ask(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultValue ? ` [${defaultValue}]` : "";

  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

/** Prompt for a secret (no echo). */
export async function askSecret(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    // Disable echo by writing directly
    process.stdout.write(`  ${question}: `);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);

    let input = "";
    const onData = (ch: Buffer) => {
      const char = ch.toString("utf8");
      if (char === "\n" || char === "\r") {
        if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        rl.close();
        resolve(input);
      } else if (char === "\u007F" || char === "\b") {
        // Backspace
        input = input.slice(0, -1);
      } else if (char === "\u0003") {
        // Ctrl+C
        process.exit(1);
      } else {
        input += char;
      }
    };

    stdin.on("data", onData);
  });
}

/** Prompt for yes/no confirmation. */
export async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const suffix = defaultYes ? " [Y/n]" : " [y/N]";
  const answer = await ask(question + suffix);
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith("y");
}
