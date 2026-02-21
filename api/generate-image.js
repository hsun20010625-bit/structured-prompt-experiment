export default async function handler(req, res) {
    // CORS (你同網域其實不一定需要，但保留)
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
    );

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    // 讓你用瀏覽器直接開 /api/generate-image 時能看到提示（不再只有 405）
    if (req.method === "GET") {
        return res.status(200).json({
            ok: true,
            message: "Use POST with JSON: { prompt: string, mode: 'structured'|'natural' }",
        });
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    try {
        const { prompt, mode } = req.body || {};
        if (!prompt || typeof prompt !== "string") {
            return res.status(400).json({ error: "Prompt is required" });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res
                .status(500)
                .json({ error: "Server configuration error (GEMINI_API_KEY missing)" });
        }

        const TARGET_MODEL = "gemini-2.5-flash-image"; // 先照你指定的

        const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${TARGET_MODEL}:generateContent?key=${apiKey}`;

        // 加 timeout，避免卡死
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25000);

        const upstream = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
                contents: [
                    {
                        parts: [{ text: prompt }],
                    },
                ],
                generationConfig: {
                    // 嘗試要求回傳圖片
                    responseMimeType: "image/png",
                },
            }),
        }).finally(() => clearTimeout(timeout));

        const rawText = await upstream.text();

        // 不是 2xx 直接把上游錯誤吐回，前端就不會 JSON parse 爆掉
        if (!upstream.ok) {
            return res.status(upstream.status).json({
                error: "Upstream Gemini error",
                status: upstream.status,
                details: rawText.slice(0, 1000),
            });
        }

        // 解析 JSON
        let data;
        try {
            data = JSON.parse(rawText);
        } catch (e) {
            return res.status(500).json({
                error: "Gemini returned non-JSON response",
                details: rawText.slice(0, 1000),
            });
        }

        // 嘗試抓出 inlineData
        const part =
            data?.candidates?.[0]?.content?.parts?.find((p) => p?.inlineData) ||
            data?.candidates?.[0]?.content?.parts?.[0];

        const inlineData = part?.inlineData;

        if (inlineData?.data && inlineData?.mimeType) {
            const mime = inlineData.mimeType;
            const b64 = inlineData.data;
            return res.status(200).json({
                image: `data:${mime};base64,${b64}`,
                mode: mode || "unknown",
            });
        }

        // 沒有圖片就把文字回傳，讓你先看到模型到底回什麼（不會再 pending）
        const text =
            part?.text ||
            data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ||
            "";

        return res.status(200).json({
            error: "No image returned from model",
            text: text.slice(0, 2000),
            raw: data,
        });
    } catch (err) {
        const msg =
            err?.name === "AbortError"
                ? "Upstream request timed out"
                : err?.message || String(err);

        return res.status(500).json({ error: msg });
    }
}