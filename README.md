# chat-pool-be

## Proje Hakkında

Bu proje, gerçek zamanlı sohbet uygulaması için geliştirilmiş bir Node.js tabanlı backend sunucusudur. Kullanıcılar, belirledikleri kullanıcı adı ile sohbete katılabilir, mesaj gönderebilir ve çevrimiçi kullanıcıları görebilirler.

## Özellikler
- Gerçek zamanlı mesajlaşma (Socket.io ile)
- Kullanıcı adı ile giriş
- Çevrimiçi kullanıcı listesinin anlık güncellenmesi
- Katılan ve ayrılan kullanıcıların sistem mesajları ile bildirilmesi
- CORS desteği
- Ortam değişkenleri ile yapılandırılabilir istemci adresi ve port

## Kurulum

1. **Depoyu klonlayın:**
   ```bash
   git clone <repo-url>
   cd chat-pool-be
   ```
2. **Bağımlılıkları yükleyin:**
   ```bash
   yarn install
   # veya
   npm install
   ```
3. **Ortam değişkenlerini ayarlayın:**
   Proje kök dizininde bir `.env` dosyası oluşturun ve aşağıdaki değişkenleri ekleyin:
   ```env
   CLIENT_URL=http://localhost:3000  # Frontend adresiniz
   PORT=5000                         # Sunucu portu
   ```
4. **Sunucuyu başlatın:**
   ```bash
   yarn start
   # veya
   npm start
   ```

## Kullanılan Teknolojiler
- [Node.js](https://nodejs.org/)
- [Express](https://expressjs.com/)
- [Socket.io](https://socket.io/)
- [dotenv](https://github.com/motdotla/dotenv)
- [cors](https://github.com/expressjs/cors)

## Sunucu Başlatıldığında
Sunucu, belirttiğiniz port üzerinde çalışır ve istemci ile gerçek zamanlı iletişim kurar. Kullanıcılar bağlandıkça ve ayrıldıkça, tüm istemcilere güncel kullanıcı listesi ve sistem mesajları iletilir.

## Katkıda Bulunanlar
- **Büşra Çetinkaya**

## Lisans
MIT