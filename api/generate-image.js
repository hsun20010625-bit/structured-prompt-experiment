export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

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
            return res.status(500).json({
                error: "Server configuration error (GEMINI_API_KEY missing)",
            });
        }

        // 🔹使用較穩定的 Gemini 生圖模型
        const MODEL = "gemini-2.0-flash-exp-image-generation";

        const API_URL =
            `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

        // 🔹增加 timeout（生圖通常需要較久）
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000);

        const styledPrompt = `
A professional studio product photo.

Object: ${prompt}

Background:
pure solid white background (#FFFFFF), seamless, no texture, no gradient

Lighting:
flat even lighting, no shadows

Color:
grayscale only, black and white, fully desaturated, no color

Composition:
single object, centered, isolated, product catalog style
`;

        const upstream = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
            },
            signal: controller.signal,
            body: JSON.stringify({
                contents: [
                    {
                        parts: [{ text: styledPrompt }],
                    },
                ],
                generationConfig: {
                    responseModalities: ["IMAGE"],
                    temperature: 0.2,
                    topP: 0.8,
                },
            }),
        }).finally(() => clearTimeout(timeout));

        const rawText = await upstream.text();

        // 🔹Debug log（Vercel logs 可看到）
        console.log("Gemini raw response:", rawText);

        if (!upstream.ok) {
            return res.status(upstream.status).json({
                error: "Upstream Gemini error",
                status: upstream.status,
                details: rawText.slice(0, 1000),
            });
        }

        let data;

        try {
            data = JSON.parse(rawText);
        } catch (e) {
            return res.status(500).json({
                error: "Gemini returned non-JSON response",
                details: rawText.slice(0, 1000),
            });
        }

        const part =
            data?.candidates?.[0]?.content?.parts?.find((p) => p?.inlineData);

        const inlineData = part?.inlineData;

        if (inlineData?.data && inlineData?.mimeType) {
            return res.status(200).json({
                image: `data:${inlineData.mimeType};base64,${inlineData.data}`,
                mode: mode || "unknown",
            });
        }

        return res.status(500).json({
            error: "Model did not return image",
            raw: data,
        });
    } catch (err) {
        return res.status(500).json({
            error:
                err?.name === "AbortError"
                    ? "Upstream request timed out"
                    : err?.message || String(err),
        });
    }
}