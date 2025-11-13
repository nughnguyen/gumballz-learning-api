// api/lesson/[...slug].js
const fetch = require('node-fetch');
const csv = require('csvtojson');

// URL Google Sheet CSV của bạn
const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTy8CweGTUMVlovuY8BwSwcjKKCHxKC7VGIGNnQ_Yuj6kxSg3R5h4kIifd_ZFRzdlK5aVzS3q4608v5/pub?gid=0&single=true&output=csv";

// Khai báo Cache toàn cục (Tái sử dụng)
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
    
    let slug = req.query.slug; 
    
    // Đảm bảo slug là một mảng: xử lý trường hợp Vercel trả về chuỗi đơn ("A1/Animals")
    if (!Array.isArray(slug)) {
        slug = (typeof slug === 'string' && slug.length > 0) ? slug.split('/') : [];
    }
    
    // Kiểm tra tính hợp lệ cơ bản
    if (slug.length < 2) {
        return res.status(400).json({ success: false, message: "Thiếu Level và Topic trong đường dẫn (/api/lesson/[LEVEL]/[TOPIC])." });
    }
    
    // Lấy Level
    const requestedLevel = slug[0].toUpperCase().trim();
    
    // Lấy Topic: Nối tất cả các phần tử còn lại (sau Level)
    const topicSegment = slug.slice(1).join('/');
    
    // Fix: DecodeURIComponent chỉ áp dụng cho toàn bộ Topic
    const requestedTopic = decodeURIComponent(topicSegment).trim(); 
    
    if (!requestedLevel || !requestedTopic) {
         return res.status(400).json({ success: false, message: "Level hoặc Topic không được định dạng hợp lệ." });
    }


    try {
        const data = await getAndParseData();

        // Lọc dữ liệu theo Level và Topic
        const lessonData = data.filter(row => 
            row.level && row.level.toUpperCase().trim() === requestedLevel &&
            row.topic && row.topic.trim() === requestedTopic
        );

        if (lessonData.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: `Không tìm thấy từ vựng cho Level ${requestedLevel} và Topic ${requestedTopic}. Vui lòng kiểm tra dữ liệu nguồn.`, 
                data: [] 
            });
        }
        
        res.status(200).json({
            success: true,
            message: `Nội dung bài học cho ${requestedLevel} - ${requestedTopic} được đồng bộ.`,
            data: lessonData,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Lỗi Server nội bộ khi xử lý bài học.",
            data: [],
        });
    }
};