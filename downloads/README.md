# Descargas Mobile (APK)

Coloca aquí el instalador Android con el nombre:

- `fl-store-mobile.apk`

Ruta pública local que sirve el backend:

- `http://<IP_LOCAL_O_HOST>:3000/downloads/fl-store-mobile.apk`

Opcionalmente puedes cambiar el nombre con la variable de entorno:

```env
MOBILE_APK_FILE_NAME=mi-app.apk
```

En ese caso, sigue descargándose por la misma ruta fija:

- `/downloads/fl-store-mobile.apk`

> Nota: iOS no instala APK. Para iPhone usa TestFlight/App Store.
