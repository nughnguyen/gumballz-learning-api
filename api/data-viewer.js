const fetch = require('node-fetch');
const csv = require('csvtojson');

// URL Google Sheet CSV của bạn
const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTy8CweGTUMVlovuY8BwSwcjKKCHxKC7VGIGNnQ_Yuj6kxSg3R5h4kIifd_ZFRzdlK5aVzS3q4608v5/pub?gid=0&single=true&output=csv";

// === THỐNG KÊ TOÀN CỤC (SỐNG TRONG THỜI GIAN INSTANCE WARM) ===
let cachedData = null;
let updateCount = 0;
let lastUpdateTime = 'Chưa cập nhật';

// Đặt thời gian khởi động cố định (12:00 trưa 13/11/2025 GMT+7)
const serverStartTime = new Date('2025-11-13T05:00:00.000Z');

const CACHE_DURATION = 3600 * 1000; // 1 giờ

// Hàm format thời gian
const formatTime = (date) => {
    if (date === 'Chưa cập nhật') return date;
    return new Date(date).toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
};

// Hàm tính Uptime
const formatUptime = (start) => {
    const diff = new Date().getTime() - start.getTime();
    if (diff < 0) return "Đã đặt giờ trong tương lai"; 
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    
    let parts = [];
    if (days > 0) parts.push(`${days} ngày`);
    if (hours > 0) parts.push(`${hours} giờ`);
    if (minutes > 0) parts.push(`${minutes} phút`);
    if (parts.length === 0) parts.push(`${seconds} giây`);
    
    return parts.join(' ');
};

// Hàm lấy và phân tích dữ liệu CSV (Đã tích hợp thống kê và bỏ qua cache)
async function getAndParseData(shouldBypassCache = false) { 
    if (!shouldBypassCache && cachedData && new Date().getTime() - cachedData.cacheTime < CACHE_DURATION) {
        return cachedData.data;
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
        
        updateCount++;
        lastUpdateTime = new Date();
        cachedData = { data: filteredData, cacheTime: new Date().getTime() };
        
        return filteredData;

    } catch (error) {
        console.error("Lỗi khi tải hoặc phân tích CSV:", error);
        if (cachedData) return cachedData.data;
        throw new Error("Không thể tải hoặc xử lý dữ liệu nguồn.");
    }
}

// Hàm chính của Serverless Function
module.exports = async (req, res) => {
    let rawData = [];
    let loadError = null;
    
    const url = new URL(`http://dummy.com${req.url}`); 
    const shouldRefresh = url.searchParams.get('refresh') === 'true';
    
    try {
        rawData = await getAndParseData(shouldRefresh);
    } catch (e) {
        loadError = e.message;
    }
    
    const levelMap = rawData.reduce((acc, row) => {
        const level = row.level.toUpperCase().trim();
        if (!acc[level]) {
            acc[level] = { level: level, word_count: 0, topicSet: new Set(), topics: {} };
        }
        acc[level].word_count += 1;
        acc[level].topicSet.add(row.topic);
        
        if (row.topic) {
            const topicName = row.topic.trim();
            if (!acc[level].topics[topicName]) {
                acc[level].topics[topicName] = { topic: topicName, word_count: 0 };
            }
            acc[level].topics[topicName].word_count += 1;
        }
        
        return acc;
    }, {});
    
    const levelsArray = Object.values(levelMap)
        .map(item => ({
            level: item.level,
            word_count: item.word_count,
            topic_count: item.topicSet.size,
            topic_details: Object.values(item.topics).sort((a, b) => a.topic.localeCompare(b.topic))
        }))
        .sort((a, b) => a.level.localeCompare(b.level));
        
    const levelsStatus = { success: !loadError, message: loadError || "Thành công", data: levelsArray };
    
    let topicsStatus = { success: false, message: "Level test không khả dụng", data: [] };
    let lessonStatus = { success: false, message: "Lesson test không khả dụng", data: [] };
    let globalStats = { totalLevels: 0, totalTopics: 0, totalWords: 0, levelStats: [] };

    let testLevel = null;
    let testTopic = null;

    if (levelsArray.length > 0) {
        testLevel = levelsArray[0].level;
        
        const currentLevel = levelsArray.find(item => item.level === testLevel);
        if (currentLevel) {
             topicsStatus = { success: true, message: "Thành công", data: currentLevel.topic_details };
        }

        if (topicsStatus.data.length > 0) {
              testTopic = topicsStatus.data[0].topic;
              
              const filteredData = rawData.filter(row => 
                  row.level && row.level.toUpperCase().trim() === testLevel &&
                  row.topic && row.topic.trim() === testTopic
              );
              lessonStatus = { success: true, message: "Thành công", data: filteredData.slice(0, 3) };
        }
        
        const allTopics = new Set(rawData.map(r => `${r.level}|${r.topic}`));
        globalStats = {
            totalLevels: levelsArray.length,
            totalTopics: allTopics.size,
            totalWords: rawData.length,
            levelStats: levelsArray
        };
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    const renderDataBox = (title, status, data, endpointPath) => {
        const isSuccess = status.success;
        const stateClass = isSuccess ? 'bg-green-100 border-green-500' : 'bg-red-100 border-red-500';
        const stateColor = isSuccess ? 'text-green-700' : 'text-red-700';

        const displayData = data ? data.slice(0, 3) : [];
        
        let sampleDataHtml = '';
        let totalItemsDisplay = isSuccess ? data.length : 0;
        let totalItemsLabel = 'Tổng số mục';

        if (title.startsWith('1. Danh sách Levels')) {
             sampleDataHtml = displayData.map(item => `
                <div class="bg-gray-50 p-2 rounded-lg text-xs">
                    <strong>Level:</strong> ${item.level}, 
                    <strong>Topic Count:</strong> ${item.topic_count || 'N/A'},
                    <strong>Word Count:</strong> ${item.word_count || 'N/A'}
                </div>
            `).join('');
            totalItemsLabel = 'Tổng số Level';
        } else if (title.startsWith('2. Danh sách Topics')) {
             sampleDataHtml = displayData.map(item => `
                <div class="bg-gray-50 p-2 rounded-lg text-xs">
                    <strong>Topic:</strong> ${item.topic}, 
                    <strong>Word Count:</strong> ${item.word_count || 'N/A'}
                </div>
            `).join('');
             totalItemsLabel = 'Tổng số Chủ đề trong Level test';
        } else if (title.startsWith('3. Nội dung Bài học')) {
             sampleDataHtml = displayData.map(item => `
                <div class="bg-gray-50 p-2 rounded-lg text-xs">
                    <strong>Word:</strong> ${item.word}, 
                    <strong>Level:</strong> ${item.level},
                    <strong>Topic:</strong> ${item.topic}
                </div>
            `).join('');
            totalItemsDisplay = rawData.filter(row => 
                row.level && row.level.toUpperCase().trim() === testLevel &&
                row.topic && row.topic.trim() === testTopic
            ).length;
            totalItemsLabel = 'Tổng số từ trong Bài học test';
        }


        return `
            <div class="bg-white p-6 rounded-xl shadow-lg mb-6 transition duration-300 hover:shadow-xl">
                <h3 class="text-xl font-bold mb-3 text-gray-800">${title}</h3>
                <p class="text-sm text-gray-500 mb-2">Endpoint: <code class="text-xs bg-gray-100 px-1 py-0.5 rounded">${endpointPath}</code></p>
                <div class="p-3 rounded-lg ${stateClass} border-l-4">
                    <p class="font-semibold text-sm ${stateColor}">Trạng thái: ${status.message}</p>
                    <p class="text-xs ${stateColor}/80 mt-1">Kết quả: ${isSuccess ? data.length + ' mục đã tìm thấy' : 'Không có dữ liệu.'}</p>
                </div>
                ${isSuccess && displayData.length > 0 ? `
                    <div class="mt-4 space-y-2 text-sm text-gray-700">
                        <p class="font-semibold text-gray-600">Dữ liệu mẫu (${displayData.length} mục đầu tiên):</p>
                        ${sampleDataHtml}
                        <p class="text-xs text-gray-500 mt-2">${totalItemsLabel}: ${totalItemsDisplay}</p>
                    </div>
                ` : ''}
            </div>
        `;
    };

    // Hàm render Cây Thư mục (Dạng Tab ngang)
    const renderTopicTree = (levels) => {
        // Tạo HTML cho các nút Levels (Tabs)
        const tabsHtml = levels.map((level, index) => `
            <button class="level-tab-button text-sm font-medium px-4 py-2 border-b-2 transition duration-300 ${index === 0 ? 'border-purple-600 text-purple-600' : 'border-transparent text-gray-500 hover:text-purple-600 hover:border-purple-300'}"
                    onclick="openLevel(event, '${level.level}')"
                    id="tab-${level.level}">
                ${level.level} (${level.word_count} từ)
            </button>
        `).join('');

        // Tạo HTML cho nội dung Tabs
        const contentHtml = levels.map((level, index) => `
            <div id="level-content-${level.level}" class="level-tab-content p-4 bg-white shadow-lg rounded-b-xl rounded-r-xl border border-t-0 border-gray-200 ${index === 0 ? 'block' : 'hidden'}">
                <h4 class="text-lg font-bold text-gray-800 mb-3">Level: ${level.level} (Tổng ${level.word_count} từ, ${level.topic_count} chủ đề)</h4>
                
                <div class="flex flex-wrap gap-2 mb-4">
                    <span class="text-sm font-medium text-gray-500 mr-2">Sắp xếp:</span>
                    <button class="sort-button text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 py-1 px-3 rounded" data-level="${level.level}" data-sort-by="topic" data-direction="asc">Tên A-Z</button>
                    <button class="sort-button text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 py-1 px-3 rounded" data-level="${level.level}" data-sort-by="topic" data-direction="desc">Tên Z-A</button>
                    <button class="sort-button text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 py-1 px-3 rounded" data-level="${level.level}" data-sort-by="count" data-direction="desc">Từ (Nhiều > Ít)</button>
                    <button class="sort-button text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 py-1 px-3 rounded" data-level="${level.level}" data-sort-by="count" data-direction="asc">Từ (Ít > Nhiều)</button>
                </div>

                <div id="topic-list-${level.level}" class="space-y-2">
                    ${level.topic_details.map(topic => `
                        <div class="topic-item bg-gray-50 p-3 rounded-lg hover:bg-gray-100 transition duration-150 flex justify-between items-center" data-topic-name="${topic.topic}" data-word-count="${topic.word_count}">
                            <span class="text-gray-700 font-medium">Chủ đề: ${topic.topic}</span>
                            <span class="text-sm font-bold text-purple-600">${topic.word_count} từ</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');

        return `
            <div class="mt-8 mb-8">
                <h2 class="text-2xl font-bold text-gray-800 mb-4">Cấu trúc Dữ liệu Chi tiết (Cây Levels & Topics)</h2>
                
                <div class="flex flex-wrap border-b border-gray-200 -mb-px">
                    ${tabsHtml}
                </div>

                <div class="levels-content-wrapper">
                    ${contentHtml}
                </div>
            </div>
            <script>
                // Hàm chuyển đổi Level Tab
                function openLevel(evt, levelName) {
                    var i, tabcontent, tablinks;
                    
                    // Ẩn tất cả nội dung tab
                    tabcontent = document.getElementsByClassName("level-tab-content");
                    for (i = 0; i < tabcontent.length; i++) {
                        tabcontent[i].style.display = "none";
                    }
                    
                    // Xóa trạng thái active của tất cả nút tab
                    tablinks = document.getElementsByClassName("level-tab-button");
                    for (i = 0; i < tablinks.length; i++) {
                        tablinks[i].classList.remove("border-purple-600", "text-purple-600");
                        tablinks[i].classList.add("border-transparent", "text-gray-500", "hover:text-purple-600", "hover:border-purple-300");
                    }
                    
                    // Hiển thị nội dung tab hiện tại và đánh dấu nút tab active
                    document.getElementById('level-content-' + levelName).style.display = "block";
                    evt.currentTarget.classList.remove("border-transparent", "text-gray-500", "hover:text-purple-600", "hover:border-purple-300");
                    evt.currentTarget.classList.add("border-purple-600", "text-purple-600");
                    
                    // Tự động sắp xếp lại lần đầu (tên A-Z) khi mở tab mới (nếu chưa có sắp xếp)
                    const activeSortButton = document.querySelector(\`#level-content-\${levelName} .sort-button.bg-purple-500\`);
                    if (!activeSortButton) {
                        const defaultSortButton = document.querySelector(\`#level-content-\${levelName} .sort-button[data-sort-by="topic"][data-direction="asc"]\`);
                        if (defaultSortButton) {
                             defaultSortButton.click();
                        }
                    }
                }

                function sortTopics(levelName, sortBy, direction) {
                    const topicListElement = document.getElementById('topic-list-' + levelName);
                    const topicItems = Array.from(topicListElement.querySelectorAll('.topic-item'));

                    topicItems.sort((a, b) => {
                        let valA, valB;

                        if (sortBy === 'topic') {
                            valA = a.getAttribute('data-topic-name').toLowerCase();
                            valB = b.getAttribute('data-topic-name').toLowerCase();
                            if (direction === 'asc') return valA.localeCompare(valB);
                            return valB.localeCompare(valA);
                        } else if (sortBy === 'count') {
                            valA = parseInt(a.getAttribute('data-word-count'));
                            valB = parseInt(b.getAttribute('data-word-count'));
                            if (direction === 'asc') return valA - valB;
                            return valB - valA;
                        }
                        return 0;
                    });

                    topicItems.forEach(item => topicListElement.appendChild(item));
                    
                    document.querySelectorAll(\`#level-content-\${levelName} .sort-button\`).forEach(btn => {
                        btn.classList.remove('bg-purple-500', 'text-white');
                        btn.classList.add('bg-gray-200', 'text-gray-800');
                    });
                    
                    const activeBtn = document.querySelector(\`#level-content-\${levelName} .sort-button[data-sort-by="\${sortBy}"][data-direction="\${direction}"]\`);
                    if(activeBtn) {
                        activeBtn.classList.remove('bg-gray-200', 'text-gray-800');
                        activeBtn.classList.add('bg-purple-500', 'text-white');
                    }
                }

                document.addEventListener('DOMContentLoaded', () => {
                    // Gán sự kiện cho các nút sắp xếp
                    document.querySelectorAll('.sort-button').forEach(button => {
                        button.addEventListener('click', function() {
                            const level = this.closest('.level-tab-content').id.replace('level-content-', '');
                            const sortBy = this.getAttribute('data-sort-by');
                            const direction = this.getAttribute('data-direction');
                            sortTopics(level, sortBy, direction);
                        });
                    });
                    
                    // Mặc định mở Level đầu tiên khi tải
                    const firstTab = document.querySelector('.level-tab-button');
                    if(firstTab) {
                        firstTab.click();
                    }
                });
             </script>
        `;
    };

    // Hàm render Footer (Đã đổi tên và cập nhật ICON)
    const renderFooter = () => {
        const contactInfo = [
            { label: 'Facebook', value: 'hungnq188.2k5', link: 'https://www.facebook.com/hungnq188.2k5', icon: 'M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z' },
            { label: 'YouTube', value: '@nughnguyen', link: 'https://www.youtube.com/@nughnguyen', icon: 'M10 15V9l5 3-5 3zM22 12c0-1.72-.1-3.41-.35-5.02a2.38 2.38 0 00-1.63-1.63C18.41 5 12 5 12 5s-6.41 0-8.02.35a2.38 2.38 0 00-1.63 1.63C2 8.59 2 12 2 12s0 3.41.35 5.02a2.38 2.38 0 001.63 1.63C5.59 19 12 19 12 19s6.41 0 8.02-.35a2.38 2.38 0 001.63-1.63C22 15.41 22 12 22 12z' }, 
            { label: 'Instagram', value: 'hq.hnug', link: 'https://www.instagram.com/hq.hnug', icon: 'M16 3H8a5 5 0 00-5 5v8a5 5 0 005 5h8a5 5 0 005-5V8a5 5 0 00-5-5zM12 17a5 5 0 110-10 5 5 0 010 10zM17.5 6.5h.01' },
            // ICON MỚI: Discord (Headset)
            { label: 'Discord', value: 'dsc.gg/thenoicez', link: 'https://dsc.gg/thenoicez', icon: 'M3 18v-6a9 9 0 0118 0v6M21 19a2 2 0 01-2 2H5a2 2 0 01-2-2v-1h18v1z' },
            { label: 'Email', value: 'hungnq.august.work@gmail.com', link: 'mailto:hungnq.august.work@gmail.com', icon: 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zM20 6l-8 5-8-5' },
            // ICON MỚI: LinkedIn (Briefcase)
            { label: 'LinkedIn', value: 'hungnq-august', link: 'https://www.linkedin.com/in/hungnq-august/', icon: 'M16 20V4H8v16M2 6h20M10 9v3M14 9v3' },
            // ICON MỚI: TikTok (Monitor)
            { label: 'TikTok', value: 'nq.hnug', link: 'https://www.tiktok.com/@nq.hnug', icon: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM10 14h4M12 10v4M8 18h8' },
            { label: 'Phone', value: '0388205003 / 0923056036', link: 'tel:0388205003', icon: 'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.63A2 2 0 014.08 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z' },
            // ICON MỚI: Zalo (Message/Contact)
            { label: 'Zalo', value: 'Hưng (0923056036)', link: 'https://zalo.me/0923056036', icon: 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zM8 12h8M8 8h8M8 16h4' },
            { label: 'Website', value: 'guns.lol/nguyenquochung', link: 'https://guns.lol/nguyenquochung', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' }
        ];

        return `
            <footer class="mt-16 pt-8 pb-4 bg-gray-900 text-white border-t-4 border-purple-600">
                <div class="container mx-auto px-4 sm:px-8">
                    <div class="text-center mb-6 relative">
                        <span class="text-xs text-gray-400 block mb-2">Developed & Maintained by</span>
                        <div class="inline-block text-2xl font-extrabold tracking-wider text-white relative">
                            <span class="quoc-hung-text relative z-10">Nguyen Quoc Hung</span>
                            <div class="heart-container">
                                <span class="heart-bubble heart-1"></span>
                                <span class="heart-bubble heart-2"></span>
                                <span class="heart-bubble heart-3"></span>
                            </div>
                        </div>
                    </div>

                    <div class="grid grid-cols-2 md:grid-cols-5 gap-6 text-sm">
                        ${contactInfo.map(item => `
                            <div class="flex items-start space-x-2">
                                <svg class="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${item.icon}"></path></svg>
                                <div>
                                    <p class="font-semibold text-gray-300">${item.label}</p>
                                    <a href="${item.link}" target="_blank" class="text-xs text-gray-400 hover:text-purple-300 transition duration-150 break-all">${item.value}</a>
                                </div>
                            </div>
                        `).join('')}
                    </div>

                    <p class="text-center text-xs text-gray-500 mt-8 pt-4 border-t border-gray-700">
                        &copy; ${new Date().getFullYear()} Nguyen Quoc Hung. All rights reserved.
                    </p>
                </div>
                <style>
                    /* Animation cho chữ Nguyen Quoc Hung */
                    @keyframes textBlink {
                        0%, 100% { color: #f3e8ff; text-shadow: 0 0 5px #9333ea, 0 0 10px #9333ea; }
                        50% { color: #ffffff; text-shadow: 0 0 10px #a78bfa, 0 0 20px #8b5cf6; }
                    }
                    .quoc-hung-text {
                        animation: textBlink 2s ease-in-out infinite;
                        text-transform: uppercase;
                        display: inline-block;
                        position: relative;
                    }

                    /* Hiệu ứng bong bóng trái tim */
                    .heart-container {
                        position: absolute;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        width: 100%;
                        height: 100%;
                        overflow: hidden;
                        pointer-events: none;
                    }

                    .heart-bubble {
                        position: absolute;
                        background-color: #ff69b4;
                        border-radius: 50%;
                        opacity: 0;
                        transform: scale(0);
                        animation-fill-mode: forwards;
                        pointer-events: none;
                    }

                    /* Định nghĩa hình trái tim bằng CSS */
                    .heart-bubble::before,
                    .heart-bubble::after {
                        content: '';
                        position: absolute;
                        width: 100%;
                        height: 100%;
                        background-color: inherit;
                        border-radius: 50%;
                        
                    }
                    /* Tùy chỉnh vị trí để tạo hình trái tim */
                    .heart-bubble::before {
                        top: -50%;
                        left: 0;
                        transform: rotate(-45deg);
                    }
                    .heart-bubble::after {
                        top: 0;
                        left: 50%;
                        transform: translateX(-50%) rotate(45deg);
                    }


                    /* Animation cho bong bóng nổ */
                    @keyframes heartPop {
                        0% {
                            transform: translate(-50%, 0) scale(0);
                            opacity: 0;
                        }
                        20% {
                            opacity: 0.8;
                            transform: translate(-50%, -20%) scale(0.6);
                        }
                        80% {
                            opacity: 0;
                            transform: translate(-50%, -100%) scale(1.2);
                        }
                        100% {
                            opacity: 0;
                            transform: translate(-50%, -120%) scale(1.3);
                        }
                    }

                    .heart-1 {
                        width: 10px; height: 10px;
                        animation: heartPop 3s ease-out infinite;
                        animation-delay: 0.5s;
                        left: 40%; top: 70%;
                    }
                    .heart-2 {
                        width: 12px; height: 12px;
                        animation: heartPop 3s ease-out infinite;
                        animation-delay: 1.5s;
                        left: 60%; top: 80%;
                    }
                    .heart-3 {
                        width: 8px; height: 8px;
                        animation: heartPop 3s ease-out infinite;
                        animation-delay: 2.5s;
                        left: 50%; top: 60%;
                    }

                </style>
            </footer>
        `;
    }

    const htmlContent = `
        <!DOCTYPE html>
        <html lang="vi">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Gumballz API Dashboard | Nguyen Quoc Hung</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
                body { font-family: 'Inter', sans-serif; background-color: #f4f7f9; }
                .text-purple-600 { color: #9333EA; }
                .bg-purple-100 { background-color: #F3E8FF; }
                /* Animation cho nút bấm */
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .animate-spin { animation: spin 1s linear infinite; }
            </style>
        </head>
        <body>
            <div class="container mx-auto p-4 sm:p-8">
                <header class="mb-8">
                    <div class="flex justify-between items-center border-b-4 border-purple-200 pb-2">
                        <h1 class="text-4xl font-extrabold text-purple-600">
                            Gumballz API Dashboard
                        </h1>
                        <button id="refresh-button" class="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition duration-300 flex items-center text-sm">
                            <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m15.356 2H15m-3-4v5h.582m-.582 0l-1.356-1.356m1.356 1.356L15 8.644m-3 3l-1.356 1.356m1.356-1.356l1.356-1.356M4 13a8.001 8.001 0 0015.356 2"></path></svg>
                            Cập nhật Ngay
                        </button>
                    </div>
                    <p class="text-gray-600 mt-2">Trạng thái đồng bộ dữ liệu từ Google Sheet CSV.</p>
                </header>
                
                <script>
                    document.getElementById('refresh-button').addEventListener('click', function() {
                        const button = this;
                        button.disabled = true;
                        button.innerHTML = '<svg class="w-4 h-4 mr-2 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m15.356 2H15m-3-4v5h.582m-.582 0l-1.356-1.356m1.356 1.356L15 8.644m-3 3l-1.356 1.356m1.356-1.356l1.356-1.356M4 13a8.001 8.001 0 0015.356 2"></path></svg> Đang tải...';
                        
                        const currentUrl = new URL(window.location.href);
                        currentUrl.searchParams.set('refresh', 'true');
                        
                        window.location.href = currentUrl.toString();
                    });
                </script>

                <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div class="bg-white p-5 rounded-xl shadow-md border-l-4 border-blue-500">
                        <p class="text-sm font-medium text-gray-500">Thời gian bắt đầu dự án</p>
                        <p class="text-2xl font-bold text-gray-800 mt-1">${formatTime(serverStartTime)}</p>
                        <p class="text-sm text-gray-500 mt-1">Giờ Việt Nam (GMT+7).</p>
                    </div>
                    <div class="bg-white p-5 rounded-xl shadow-md border-l-4 border-yellow-500">
                        <p class="text-sm font-medium text-gray-500">Thời gian hoạt động (Uptime)</p>
                        <p class="text-2xl font-bold text-gray-800 mt-1">${formatUptime(serverStartTime)}</p>
                        <p class="text-sm text-gray-500 mt-1">Tính từ mốc 12h ngày 13/11/2025.</p>
                    </div>
                    <div class="bg-white p-5 rounded-xl shadow-md border-l-4 border-purple-500">
                        <p class="text-sm font-medium text-gray-500">Cập nhật gần nhất</p>
                        <p class="text-2xl font-bold text-gray-800 mt-1">${formatTime(lastUpdateTime)}</p>
                        <p class="text-sm text-gray-500 mt-1">Số lần đồng bộ: ${updateCount}</p>
                    </div>
                </div>
                
                <h2 class="text-2xl font-bold text-gray-800 mb-4">Thống kê Dữ liệu Tổng quát (CSV)</h2>
                 <div class="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
                    <div class="bg-white p-5 rounded-xl shadow-md border-l-4 border-green-500">
                        <p class="text-sm font-medium text-gray-500">Tổng Level</p>
                        <p class="text-3xl font-bold text-gray-800 mt-1">${globalStats.totalLevels}</p>
                        <p class="text-sm text-gray-500 mt-1">Hiện có: ${globalStats.levelStats.map(s => s.level).join(', ')}</p>
                    </div>
                    <div class="bg-white p-5 rounded-xl shadow-md border-l-4 border-indigo-500">
                        <p class="text-sm font-medium text-gray-500">Tổng Chủ đề</p>
                        <p class="text-3xl font-bold text-gray-800 mt-1">${globalStats.totalTopics}</p>
                        <p class="text-sm text-gray-500 mt-1">Qua tất cả các Level.</p>
                    </div>
                    <div class="bg-white p-5 rounded-xl shadow-md border-l-4 border-pink-500">
                        <p class="text-sm font-medium text-gray-500">Tổng Từ vựng</p>
                        <p class="text-3xl font-bold text-gray-800 mt-1">${globalStats.totalWords}</p>
                        <p class="text-sm text-gray-500 mt-1">Tất cả các Level và Chủ đề.</p>
                    </div>
                </div>

                <h2 class="text-2xl font-bold text-gray-800 mb-4">Kiểm tra Endpoints (Kiểm tra API tự động)</h2>
                
                ${renderDataBox(
                    '1. Danh sách Levels (Level Array)', 
                    levelsStatus, 
                    levelsStatus.data,
                    '/api/vocabulary/list-levels'
                )}

                ${renderDataBox(
                    `2. Danh sách Topics (Test Level: ${testLevel || 'N/A'})`,
                    topicsStatus, 
                    topicsStatus.data,
                    `/api/vocabulary/list-topics?level=${testLevel || 'N/A'}`
                )}
                
                ${renderDataBox(
                    `3. Nội dung Bài học (Test Topic: ${testTopic || 'N/A'})`,
                    lessonStatus, 
                    lessonStatus.data,
                    `/api/lesson/${testLevel || 'N/A'}/${encodeURIComponent(testTopic || 'N/A')}`
                )}

                ${renderTopicTree(levelsArray)}

            </div>
            ${renderFooter()}
        </body>
        </html>
    `;

    res.status(200).send(htmlContent);
};