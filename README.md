# Aurora

## [Open Aurora →](https://jeancaffou.github.io/auroralapse/)

A progressive web app for photographing auroras and creating timelapse videos on your device.

- Capture photos at a chosen interval and duration, with manual shutter time and auto-exposure bias when supported by the camera.
- Enable Handheld mode to reduce small shifts and rotations during video generation. Stabilization uses reliable frames where possible and continues through frames it cannot align. You can also generate without stabilization.
- Browse photo sessions in the local library and export MP4 videos named `yyyy-mm-dd-hh-mm-ss.mp4` using the capture start time.
- Install the app for offline use and use screen dimming during night photography.

Photos and video processing stay on your device. Keep the app open while capturing. Clearing browser data removes saved sessions.

## Run

```sh
npm ci
npm run dev
```

For a production build:

```sh
npm run build
npm run preview
```

Camera access requires HTTPS or localhost. Camera controls and MP4 export depend on browser support.

## Credits

Aurora photographs: [Kafol.net](https://foto.kafol.net/en/2024/05/severni-sij-aurora-borealis-v-sloveniji-maj-2024.html).
