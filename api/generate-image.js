export default async function handler(req, res) {
    // 1. CORS 與 基本 Header 設定
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") return res.status(200).end();

    if (req.method === "GET") {
        return res.status(200).json({
            ok: true,
            message: "Use POST with JSON: { prompt: string }",
        });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    // 2. 取得參數與 API Key
    const { prompt, mode } = req.body || {};
    if (!prompt || typeof prompt !== "string") return res.status(400).json({ error: "Prompt is required" });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Server configuration error (GEMINI_API_KEY missing)" });

    // 使用 2.0 Flash 模型研發版 (Experimental)
    const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent";

    const styledPrompt = `
    A professional studio product photo.
    Object: ${prompt}
    Background: pure solid white background (#FFFFFF), seamless, no texture, no gradient
    Lighting: flat even lighting, no shadows
    Color: grayscale only, black and white, fully desaturated, no color
    Composition: single object, centered, isolated, product catalog style
    `;

    // 3. 封裝請求函數（為了支援重試）
    const fetchWithRetry = async (retries = 2, delay = 2000) => {
        for (let i = 0; i <= retries; i++) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000); // 生圖較慢，給 30 秒

            try {
                const response = await fetch(`${API_URL}?key=${apiKey}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    signal: controller.signal,
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: styledPrompt }] }],
                        generationConfig: {
                            responseModalities: ["IMAGE"],
                        },
                        // 放寬安全設定，避免因誤判導致 429 或 400 錯誤
                        safetySettings: [
                            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                        ]
                    }),
                });

                if (response.ok) return response;

                // 如果是 429 且還有重試機會，就等待後重試
                if (response.status === 429 && i < retries) {
                    console.warn(`Retry attempt ${i + 1} due to 429 error...`);
                    await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
                    continue;
                }

                return response; // 其他錯誤直接回傳
            } catch (err) {
                if (i === retries) throw err;
            } finally {
                clearTimeout(timeout);
            }
        }
    };

    try {
        const upstream = await fetchWithRetry();
        const rawText = await upstream.text();

        if (!upstream.ok) {
            console.error("Gemini Error Payload:", rawText);
            return res.status(upstream.status).json({
                error: "Upstream Gemini error",
                status: upstream.status,
                details: rawText // 讓前端能看到具體是哪個 Quota 爆了
            });
        }

        const data = JSON.parse(rawText);

        // 4. 解析圖片數據
        const part = data?.candidates?.[0]?.content?.parts?.find((p) => p?.inlineData);
        const inlineData = part?.inlineData;

        if (inlineData?.data && inlineData?.mimeType) {
            return res.status(200).json({
                image: `data:${inlineData.mimeType};base64,${inlineData.data}`,
                mode: mode || "unknown",
            });
        }

        return res.status(500).json({
            error: "Model did not return image (Safety filter might have blocked it)",
            raw: data,
        });

    } catch (err) {
        return res.status(500).json({
            error: err?.name === "AbortError" ? "Request timed out" : err?.message || String(err),
        });
    }
}