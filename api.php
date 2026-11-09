<?php
header('Content-Type: application/json; charset=utf-8');

function fail($code, $msg) {
    http_response_code($code);
    echo json_encode(['error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'Méthode non autorisée.');

$key = getenv('GEMINI_API_KEY') ?: ($_ENV['GEMINI_API_KEY'] ?? $_SERVER['GEMINI_API_KEY'] ?? '');
if (!$key) fail(500, 'La clé API n’est pas configurée sur le serveur.');

$in = json_decode(file_get_contents('php://input'), true);
$img = $in['image'] ?? '';
$mime = $in['mime'] ?? 'image/jpeg';
if (!$img || !in_array($mime, ['image/jpeg', 'image/png', 'image/webp']) || strlen($img) > 7000000) {
    fail(400, 'Image invalide ou trop lourde.');
}

$prompt = "Tu reçois la photo d’une page de vocabulaire scolaire (liste, tableau, définitions, phrases, ou un mélange). "
    . "Extrais tout le contenu à apprendre sous forme de cartes recto/verso. "
    . "Pour chaque entrée : « front » = le mot, l’expression ou la question ; « back » = sa traduction, sa définition ou sa réponse. "
    . "Conserve les langues d’origine et l’orthographe exacte (accents, articles, genres). "
    . "Ignore les numéros, décorations et annotations sans rapport. Si une partie est illisible, saute-la. "
    . "Donne aussi un « title » court (3 à 6 mots) décrivant le thème de la page.";

$payload = [
    'contents' => [[
        'parts' => [
            ['text' => $prompt],
            ['inline_data' => ['mime_type' => $mime, 'data' => $img]],
        ],
    ]],
    'generationConfig' => [
        'responseMimeType' => 'application/json',
        'responseSchema' => [
            'type' => 'OBJECT',
            'properties' => [
                'title' => ['type' => 'STRING'],
                'cards' => [
                    'type' => 'ARRAY',
                    'items' => [
                        'type' => 'OBJECT',
                        'properties' => [
                            'front' => ['type' => 'STRING'],
                            'back' => ['type' => 'STRING'],
                        ],
                        'required' => ['front', 'back'],
                    ],
                ],
            ],
            'required' => ['title', 'cards'],
        ],
    ],
];

$url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
$body = json_encode($payload);
$headers = ['Content-Type: application/json', 'x-goog-api-key: ' . $key];

if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 60,
    ]);
    $res = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
} else {
    $ctx = stream_context_create(['http' => [
        'method' => 'POST',
        'header' => implode("\r\n", $headers),
        'content' => $body,
        'timeout' => 60,
        'ignore_errors' => true,
    ]]);
    $res = @file_get_contents($url, false, $ctx);
    $status = 0;
    if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) $status = (int)$m[1];
}

if ($res === false || !$res) fail(502, 'Impossible de joindre Gemini.');
if ($status === 429) fail(429, 'Limite gratuite atteinte. Réessaie dans une minute.');
if ($status >= 400) fail(502, 'Gemini a refusé la requête (code ' . $status . ').');

$data = json_decode($res, true);
$text = $data['candidates'][0]['content']['parts'][0]['text'] ?? '';
$out = json_decode($text, true);
if (!is_array($out) || empty($out['cards'])) fail(422, 'Aucun vocabulaire lisible sur cette photo.');

echo json_encode($out, JSON_UNESCAPED_UNICODE);
