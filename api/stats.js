const fetch = require('node-fetch');
const csv = require('csvtojson');

// URL Google Sheet CSV của bạn
const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTy8CweGTUMVlovuY8BwSwcjKKCHxKC7VGIGNnQ_Yuj6kxSg3R5h4kIifd_ZFRzdlK5aVzS3q4608v5/pub?gid=0&single=true&output=csv";

// === LOGIC CACHE VÀ DATA LOADING ===
let cachedStats = null;
let cachedRawData = null;
const CACHE_DURATION = 3600 * 1000; // 1 giờ

async function getRawData() {
    if (cachedRawData && new Date().getTime() - cachedRawData.cacheTime < CACHE_DURATION) {
        return cachedRawData.data;
    }

    try {
        const response = await fetch(GOOGLE_SHEET_CSV_URL);
        const csvText = await response.text();
        
        const data = await csv({
            noheader: false,
            headers: ['level', 'topic', 'word', 'wordType', 'phonetic', 'mean', 'definition_vi', 'definition_us', 'example', 'synonym', 'antonym'],
            skipLines: 0 
        }).fromString(csvText);

        const filteredData = data.filter(row => row.word && row.level);
        
        cachedRawData = { data: filteredData, cacheTime: new Date().getTime() };
        return filteredData;

    } catch (error) {
        console.error("Lỗi khi tải hoặc phân tích CSV:", error);
        if (cachedRawData) return cachedRawData.data;
        throw new Error("Không thể tải hoặc xử lý dữ liệu nguồn.");
    }
}

// === HÀM TÍNH TOÁN THỐNG KÊ ===
async function calculateStats() {
    const rawData = await getRawData();

    if (rawData.length === 0) {
        return {
            totalLevels: 0,
            totalTopics: 0,
            totalWords: 0,
            levelStats: [],
        };
    }
    
    const levelMap = new Map();
    const allTopics = new Set();
    let totalWords = 0;

    rawData.forEach(row => {
        const level = row.level.toUpperCase().trim();
        const topic = row.topic.trim();

        totalWords++;
        allTopics.add(`${level}|${topic}`); // Dùng Level|Topic để đếm Topic duy nhất

        if (!levelMap.has(level)) {
            levelMap.set(level, {
                wordCount: 0,
                topicSet: new Set(),
            });
        }

        const stats = levelMap.get(level);
        stats.wordCount++;
        stats.topicSet.add(topic);
    });

    const levelStats = Array.from(levelMap.entries())
        .map(([level, stats]) => ({
            level: level,
            topicCount: stats.topicSet.size,
            wordCount: stats.wordCount,
        }))
        .sort((a, b) => a.level.localeCompare(b.level)); // Sắp xếp A1, A2...

    return {
        totalLevels: levelMap.size,
        totalTopics: allTopics.size,
        totalWords: totalWords,
        levelStats: levelStats,
    };
}


module.exports = async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    try {
        const stats = await calculateStats();
        
        // Cập nhật lastUpdateTime để người dùng thấy thay đổi
        let lastUpdateDisplay = "Không cần cập nhật";
        if (cachedRawData) {
            lastUpdateDisplay = new Date(cachedRawData.cacheTime).toLocaleString('vi-VN');
        }


        res.status(200).json({
            success: true,
            message: "Thống kê dữ liệu tổng thể từ CSV.",
            lastUpdated: lastUpdateDisplay,
            data: stats,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Lỗi Server nội bộ khi tính toán thống kê.",
            data: null,
        });
    }
};