FROM node:18-alpine

WORKDIR /app

# Instalar dependencias primero para aprovechar la caché de Docker
COPY package*.json ./
RUN npm install

# Copiar el resto del código
COPY . .

# Comando de inicio del bot
CMD ["npm", "start"]
