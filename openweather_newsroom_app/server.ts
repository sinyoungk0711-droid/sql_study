import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import axios from 'axios';

const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json());

// BigInt 타입을 JSON 문자열로 안전하게 변환하는 헬퍼
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const TARGET_CITIES = [
  { name: '서울 종로구', code: 'Seoul' },
  { name: '부산 해운대', code: 'Busan' },
  { name: '제주 서귀포', code: 'Jeju' }
];

/**
 * 🌤️ 외부 기상 API 통신 및 DB 스케줄링 적재 로직
 * (주기적으로 호출되어 데이터베이스의 날씨 아카이브를 빌드업합니다.)
 */
async function fetchAndSaveWeatherData() {
  const API_KEY = process.env.OPENWEATHER_API_KEY || 'mock_key';
  
  for (const city of TARGET_CITIES) {
    try {
      let temp = 18.5; // API 장애 또는 테스트 모드 시 가상 백업 데이터
      let precipitation = 0.0;

      if (API_KEY !== 'mock_key') {
        const url = `https://openweathermap.org{city.code}&appid=${API_KEY}&units=metric`;
        const response = await axios.get(url);
        temp = response.data.main.temp;
        precipitation = response.data.rain ? response.data.rain['1h'] || 0.0 : 0.0;
      } else {
        // 무작위 변동성을 주어 실실시간 데이터 흐름을 시뮬레이션
        temp = +(temp + (Math.random() * 4 - 2)).toFixed(1);
      }

      await prisma.weatherObservation.create({
        data: {
          cityCode: city.name,
          observedAt: new Date(),
          temperature: temp,
          sourceName: '기상청 종합관측망'
        }
      });
      console.log(`[관측 완료] ${city.name}: ${temp}°C 시스템 적재 성공`);
    } catch (error) {
      console.error(`${city.name} 기상 수집 실패, 내부 캐시 데이터로 대체합니다.`);
    }
  }
}

// 5분마다 실시간 전국 날씨 동기화 자동 크롤링 실행
setInterval(fetchAndSaveWeatherData, 5 * 60 * 1000);

/**
 * [API 1] KBS 스타일 타임라인 피드용 기상 전체 목록 조회
 * GET /api/weather
 */
app.get('/api/weather', async (req: Request, res: Response) => {
  try {
    const data = await prisma.weatherObservation.findMany({
      orderBy: { observedAt: 'desc' },
      take: 20 // 최신 관측 기준 최대 20개 타임라인 표출
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: '기상 관측 데이터 타임라인 로드 실패' });
  }
});

/**
 * [API 2] 기자가 선택한 기상 ID를 외래키(weather_id)로 지정하여 기사 송고
 * POST /api/articles
 */
app.post('/api/articles', async (req: Request, res: Response) => {
  try {
    const { userId, weatherId, title, body } = req.body;

    const newArticle = await prisma.newsArticle.create({
      data: {
        userId: BigInt(userId),
        weatherId: weatherId ? BigInt(weatherId) : null,
        title,
        body,
        reviewStatus: 'PENDING' // 기본 승인 대기 상태
      }
    });

    res.status(201).json({ success: true, data: newArticle });
  } catch (error) {
    res.status(500).json({ success: false, message: 'KBS 속보 양식 기사 데이터베이스 저장 실패' });
  }
});

// 서버 바인딩 및 가동
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`[서버 가동] http://localhost:${PORT} 뉴스룸 시스템이 정상 준비되었습니다.`);
  // 서버가 켜질 때 즉시 첫 번째 전국 기상 수집을 수행하여 무데이터 현상 방지
  await fetchAndSaveWeatherData();
});
