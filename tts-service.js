const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Конфигурация TTS сервисов
const TTS_CONFIG = {
    // ElevenLabs (рекомендуется - бесплатный план: 10,000 символов/месяц)
    elevenlabs: {
        apiKey: process.env.ELEVENLABS_API_KEY || 'sk_efb4337b833d9137ef6614d43bc48d44f9c637323fa19ca6',
        baseUrl: 'https://api.elevenlabs.io/v1',
        voices: {
            male: 'pNInz6obpgDQGcFmaJgB', // Adam
            female: 'EXAVITQu4vr4xnSDxMaL' // Bella
        }
    },
    
    // Google Text-to-Speech (альтернатива)
    google: {
        baseUrl: 'https://text-to-speech-api.vercel.app/api/tts'
    },
    
    // Yandex SpeechKit (для русскоязычного контента)
    yandex: {
        apiKey: process.env.YANDEX_API_KEY || 'd5ddeh1h20b5bvhpbgiq', //YOUR_YANDEX_API_KEY
        baseUrl: 'https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize'
    }
};

/**
 * Генерация TTS аудио через ElevenLabs
 */
async function generateElevenLabsTTS(text, voice = 'female', uploadsDir) {
    try {
        const voiceId = TTS_CONFIG.elevenlabs.voices[voice] || TTS_CONFIG.elevenlabs.voices.female;
        
        const response = await axios({
            method: 'POST',
            url: `${TTS_CONFIG.elevenlabs.baseUrl}/text-to-speech/${voiceId}`,
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': TTS_CONFIG.elevenlabs.apiKey
            },
            data: {
                text: text,
                model_id: 'eleven_monolingual_v1',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.5
                }
            },
            responseType: 'arraybuffer'
        });
        
        const audioPath = path.join(uploadsDir, `audio_elevenlabs_${uuidv4()}.mp3`);
        await fs.writeFile(audioPath, response.data);
        return audioPath;
        
    } catch (error) {
        console.error('Ошибка ElevenLabs TTS:', error.message);
        throw error;
    }
}

/**
 * Генерация TTS аудио через Google TTS
 */
async function generateGoogleTTS(text, voice = 'female', uploadsDir) {
    try {
        const voiceParam = voice === 'female' ? 'female' : 'male';
        
        const response = await axios({
            method: 'GET',
            url: `${TTS_CONFIG.google.baseUrl}?text=${encodeURIComponent(text)}&voice=${voiceParam}`,
            responseType: 'arraybuffer',
            timeout: 30000
        });
        
        const audioPath = path.join(uploadsDir, `audio_google_${uuidv4()}.mp3`);
        await fs.writeFile(audioPath, response.data);
        return audioPath;
        
    } catch (error) {
        console.error('Ошибка Google TTS:', error.message);
        throw error;
    }
}

/**
 * Генерация TTS аудио через Yandex SpeechKit
 */
async function generateYandexTTS(text, voice = 'female', uploadsDir) {
    try {
        const voiceParam = voice === 'female' ? 'alena' : 'filipp';
        
        const response = await axios({
            method: 'POST',
            url: TTS_CONFIG.yandex.baseUrl,
            headers: {
                'Authorization': `Api-Key ${TTS_CONFIG.yandex.apiKey}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            data: new URLSearchParams({
                text: text,
                voice: voiceParam,
                format: 'mp3',
                sampleRateHertz: 48000
            }),
            responseType: 'arraybuffer'
        });
        
        const audioPath = path.join(uploadsDir, `audio_yandex_${uuidv4()}.mp3`);
        await fs.writeFile(audioPath, response.data);
        return audioPath;
        
    } catch (error) {
        console.error('Ошибка Yandex TTS:', error.message);
        throw error;
    }
}

/**
 * Основная функция генерации TTS с fallback
 */
async function generateTTS(text, voice = 'female', uploadsDir) {
    const services = [
        { name: 'ElevenLabs', func: generateElevenLabsTTS },
        { name: 'Google', func: generateGoogleTTS },
        { name: 'Yandex', func: generateYandexTTS }
    ];
    
    for (const service of services) {
        try {
            console.log(`Пробуем ${service.name} TTS...`);
            const audioPath = await service.func(text, voice, uploadsDir);
            console.log(`✅ ${service.name} TTS успешно сгенерирован`);
            return audioPath;
        } catch (error) {
            console.log(`❌ ${service.name} TTS не удался:`, error.message);
            continue;
        }
    }
    
    // Если все сервисы не работают, создаем пустой аудио файл
    console.log('⚠️ Все TTS сервисы недоступны, создаем пустой аудио файл');
    const audioPath = path.join(uploadsDir, `audio_empty_${uuidv4()}.mp3`);
    await fs.writeFile(audioPath, '');
    return audioPath;
}

module.exports = {
    generateTTS,
    generateElevenLabsTTS,
    generateGoogleTTS,
    generateYandexTTS
}; 