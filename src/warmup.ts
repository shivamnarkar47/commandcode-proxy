// Best-effort upstream TLS warm-up: fire a trivial request so the first real
// user turn reuses a warm socket instead of paying the TLS handshake.

export async function warmUpstream(
  baseUrl: string,
  apiKey: string,
  version: string,
): Promise<{ ok: boolean; ms: number; error?: string }> {
  const t0 = Date.now();
  const body = {
    config: {
      workingDir: "",
      date: new Date().toISOString().slice(0, 10),
      environment: "production",
      structure: [],
      isGitRepo: false,
      currentBranch: "",
      mainBranch: "",
      gitStatus: "",
      recentCommits: [],
    },
    memory: "",
    taste: null,
    skills: null,
    permissionMode: "standard",
    params: {
      model: "deepseek/deepseek-v4-flash",
      system: "",
      messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
      tools: [],
      max_tokens: 1,
      stream: true,
    },
  };
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/alpha/generate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        connection: "keep-alive",
        authorization: `Bearer ${apiKey}`,
        "x-cli-environment": "production",
        "x-command-code-version": version,
      },
      body: JSON.stringify(body),
    });
    await res.body?.cancel().catch(() => {});
    return { ok: res.ok, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: (e as Error).message };
  }
}
