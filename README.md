# IEDON-NET-API

This is API server designed for iEdon-Net. Based on Koa.js.

## Structures

This project is based on Koa's onion model which means all components and handlers are actually middlewares to extend a http server.

- **```app.js```**: Entry point
- **```routes.js```**: Define routes here
- **```./handlers```**: Handlers for each defined route
- **```providers```**: Extendable basic components
- **```db```**: Sequelize Models and database context
- **```common```**: shared functions
- **```acorle-sdk```**: My personal internal tiny microservice integration. You can safely turn it off in config.js and just ignore it.

## Install

```bash
npm install
cd acorle-sdk
npm install
cp ./config.default.js ./config.js
```

## Run dev

```bash
npm run dev
```

## Run prod

```bash
npm install -g pm2
pm2 start
```
