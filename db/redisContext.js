import Redis from "ioredis";

export async function useRedisContext(app, redisSettings) {
  const dbLogger = app.logger.getLogger("database");
  redisSettings.driver.lazyConnect = true;
  const redis = new Redis(redisSettings.driver);
  redis.on("error", (err) => {
    dbLogger.error(err);
  });
  await redis.connect();

  // Define custom command for merging enum data atomically
  redis.defineCommand("mergeEnum", {
    numberOfKeys: 1,
    lua: `
      local key = KEYS[1]
      local newData = cjson.decode(ARGV[1])
      local existing = redis.call('GET', key)
      local merged = {}
      
      if existing then
        merged = cjson.decode(existing)
      end
      
      for uuid, peers in pairs(newData) do
        merged[uuid] = peers
      end
      
      return redis.call('SET', key, cjson.encode(merged))
    `,
  });

  app.redis = {
    setData: async (key, data) => {
      try {
        return await redis.set(
          key,
          JSON.stringify(data)
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
    deleteData: async (key) => {
      try {
        return await redis.del(key) > 0;
      } catch (err) {
        dbLogger.error(`Error deleting data from redis for key ${key}:`, err);
        return false;
      }
    },
    getInstance: () => redis,
  };
}
