const axios = require('axios');
const cheerio = require('cheerio');

async function testScraper() {
    try {
        console.log('正在獲取 lolesports.com 的比賽資料...');
        const response = await axios.get('https://lolesports.com/schedule', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        
        const $ = cheerio.load(response.data);
        
        // 檢查頁面結構
        console.log('\n頁面標題:', $('title').text());
        
        // 檢查可能的比賽容器
        console.log('\n檢查可能的比賽容器:');
        $('div').each((i, el) => {
            const className = $(el).attr('class');
            if (className && (
                className.includes('match') || 
                className.includes('game') || 
                className.includes('event')
            )) {
                console.log('找到可能的比賽容器:', className);
            }
        });

        // 檢查所有具有特定類名的元素
        console.log('\n檢查所有具有特定類名的元素:');
        const selectors = [
            '.match-item',
            '.game-item',
            '.event-item',
            '[data-testid*="match"]',
            '[data-testid*="game"]',
            '[data-testid*="event"]'
        ];

        selectors.forEach(selector => {
            const elements = $(selector);
            if (elements.length > 0) {
                console.log(`找到 ${selector} 元素:`, elements.length, '個');
                elements.each((i, el) => {
                    console.log('元素內容:', $(el).text().trim().substring(0, 100));
                });
            }
        });

    } catch (error) {
        console.error('錯誤:', error.message);
        if (error.response) {
            console.error('狀態碼:', error.response.status);
            console.error('回應頭:', error.response.headers);
        }
    }
}

testScraper(); 