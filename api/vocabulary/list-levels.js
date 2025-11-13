// api/vocabulary/list-levels.js
const fetch = require('node-fetch');
const csv = require('csvtojson');

// URL Google Sheet CSV của bạn
const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/sheets/d/e/2PACX-1vTy8CweGTUMVlovuY8BwSwcjKKCHxKC7VGIGNnQ_Yuj6kxSg3R5h4kIifd_ZFRzdlK5aVzS3q4608v5/pub?gid=0&single=true&output=csv";

// Khai báo Cache toàn cục
let cachedData = null;
let cacheTime = 0;
const CACHE_DURATION = 3600 * 1000; // 1 giờ

// Hàm lấy và phân tích dữ liệu CSV
async function getAndParseData() {
    // Kiểm tra cache
    if (cachedData && Date.now() - cacheTime < CACHE_DURATION) {
        return cachedData;
    }

    try {
        const response = await fetch(GOOGLE_SHEET_CSV_URL);
        const csvText = await response.text();
        
        // Sử dụng csvtojson để chuyển đổi và đặt tên header theo cấu trúc file của bạn
        const data = await csv({
            noheader: false,
            headers: ['level', 'topic', 'word', 'wordType', 'phonetic', 'mean', 'definition_vi', 'definition_us', 'example', 'synonym', 'antonym'],
            skipLines: 0 
        }).fromString(csvText);

        // Cập nhật cache (lọc bỏ hàng trống)
        cachedData = data.filter(row => row.word && row.level);
        cacheTime = Date.now();
        
        return cachedData;

    } catch (error) {
        console.error("Lỗi khi tải hoặc phân tích CSV:", error);
        if (cachedData) return cachedData;
        throw new Error("Không thể tải hoặc xử lý dữ liệu nguồn.");
    }
}

module.exports = async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    // Đặt CORS header
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const data = await getAndParseData();

        // 1. Nhóm dữ liệu theo Level
        const levelMap = data.reduce((acc, row) => {
            if (!row.level) return acc;
            
            const level = row.level.toUpperCase().trim();
            if (!acc[level]) {
                acc[level] = {
                    level: level,
                    word_count: 0,
                    topicSet: new Set(),
                };
            }
            acc[level].word_count += 1;
            acc[level].topicSet.add(row.topic);
            return acc;
        }, {});

        // 2. Chuyển đổi Map thành Array và sắp xếp
        const levelsArray = Object.values(levelMap)
            .map(item => ({
                level: item.level,
                word_count: item.word_count,
                topic_count: item.topicSet.size 
            }))
            .sort((a, b) => a.level.localeCompare(b.level));

        res.status(200).json({
            success: true,
            message: "Danh sách Levels được đồng bộ từ Google Sheet.",
            data: levelsArray,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Lỗi Server nội bộ khi xử lý Level.",
            data: [],
        });
    }
}; 
