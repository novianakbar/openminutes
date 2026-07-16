FROM mcr.microsoft.com/playwright:v1.61.1-noble

RUN apt-get update \
    && apt-get install -y --no-install-recommends pulseaudio ffmpeg xvfb x11vnc \
    && rm -rf /var/lib/apt/lists/*

# Media palsu "aman" untuk fake device Chromium. Default fake device
# menghasilkan nada beep (audio) & pola hijau bergerak (video) — kalau mute
# gagal, itulah yang diterima peserta. Dengan file ini, kebocoran apa pun
# hanya berupa hening & frame hitam. (Header y4m ffmpeg C420mpeg2 tidak
# didukung parser Chromium, ganti ke C420jpeg.)
RUN mkdir -p /app/assets \
    && ffmpeg -f lavfi -i anullsrc=r=48000:cl=mono -t 1 /app/assets/silence.wav \
    && ffmpeg -f lavfi -i color=c=black:s=640x360:r=5 -t 1 -pix_fmt yuv420p /app/assets/black.y4m \
    && sed -i '1s/C420mpeg2/C420jpeg/' /app/assets/black.y4m

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

ENV DISPLAY=:99
ENTRYPOINT ["./entrypoint.sh"]
