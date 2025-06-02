import Redis from "ioredis";

export async function useRedisContext(app, redisSettings) {
  const dbLogger = app.logger.getLogger("database");
  redisSettings.driver.lazyConnect = true;
  const redis = new Redis(redisSettings.driver);
  redis.on("error", (err) => {
    dbLogger.error(err);
  });

  await redis.connect();

  app.redis = {
    setData: async (key, data) => {
      try {
        return await redis.set(
          key,
          JSON.stringify(data),
          "EX",
          redisSettings.ttlSeconds
        ) === "OK"; // Set with expiry
      } catch (err) {
        dbLogger.error(`Error writing data to redis for key ${key}:`, err);
        return false;
      }
    },
    getData: async (key) => {
      try {
        const result = await redis.get(key);
        return result ? JSON.parse(result) : null;
      } catch (err) {
        dbLogger.error(`Error fetching data from redis for key ${key}:`, err);
        return null;
      }
    },
  };
}
