// api/vocabulary/list-topics.js
const fetch = require('node-fetch');
const csv = require('csvtojson');

// URL Google Sheet CSV của bạn
const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTy8CweGTUMVlovuY8BwSwcjKKCHxKC7VGIGNnQ_Yuj6kxSg3R5h4kIifd_ZFRzdlK5aVzS3q4608v5/pub?gid=0&single=true&output=csv";

// Khai báo Cache toàn cục (Sử dụng lại logic cache của list-levels.js)
let cachedData = null;
let cacheTime = 0;
const CACHE_DURATION = 3600 * 1000; // 1 giờ

async function getAndParseData() {
    if (cachedData && Date.now() - cacheTime < CACHE_DURATION) {
        return cachedData;
    }

    try {
        const response = await fetch(GOOGLE_SHEET_CSV_URL);
        const csvText = await response.text();
        const data = await csv({
            noheader: false,
            headers: ['level', 'topic', 'word', 'wordType', 'phonetic', 'mean', 'definition_vi', 'definition_us', 'example', 'synonym', 'antonym'],
            skipLines: 0 
        }).fromString(csvText);

        cachedData = data.filter(row => row.word && row.level);
        cacheTime = Date.now();
        return cachedData;
    } catch (error) {
        if (cachedData) return cachedData;
        throw new Error("Không thể tải hoặc xử lý dữ liệu nguồn.");
    }
}

module.exports = async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    const requestedLevel = req.query.level ? req.query.level.toUpperCase().trim() : null;

    if (!requestedLevel) {
        return res.status(400).json({ success: false, message: "Thiếu tham số 'level'." });
    }

    try {
        const data = await getAndParseData();

        // 1. Lọc dữ liệu theo Level
        const filteredData = data.filter(row => row.level && row.level.toUpperCase().trim() === requestedLevel);

        // 2. Nhóm dữ liệu đã lọc theo Topic
        const topicMap = filteredData.reduce((acc, row) => {
            if (!row.topic) return acc;

            const topicName = row.topic.trim();
            if (!acc[topicName]) {
                acc[topicName] = {
                    topic: topicName,
                    word_count: 0,
                };
            }
            acc[topicName].word_count += 1;
            return acc;
        }, {});

        // 3. Chuyển đổi Map thành Array
        const topicsArray = Object.values(topicMap);

        res.status(200).json({
            success: true,
            message: `Danh sách Topics cho Level ${requestedLevel} được đồng bộ.`,
            data: topicsArray,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Lỗi Server nội bộ khi xử lý Topic.",
            data: [],
        });
    }
}; 
