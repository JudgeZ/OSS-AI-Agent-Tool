import express, { type Request, type Response } from 'express';
import type { Server } from 'http';
import { z } from 'zod';

const cacheWriteSchema = z.object({
  key: z.string().min(1, 'key must not be empty'),
  value: z.string()
});

export interface CacheWritePayload {
  key: string;
  value: string;
}

export const createApp = () => {
  const app = express();
  app.use(express.json());

  app.get('/healthz', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  app.post('/state/cache', (req: Request, res: Response) => {
    const parseResult = cacheWriteSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid payload',
        details: parseResult.error.format()
      });
      return;
    }

    const record: CacheWritePayload = parseResult.data;
    res.status(202).json({
      message: 'Stub: cache write scheduled',
      record
    });
  });

  app.get('/state/cache/:key', (req: Request, res: Response) => {
    res.status(200).json({
      key: req.params.key,
      value: null,
      message: 'Stub: cache lookup not yet implemented'
    });
  });

  return app;
};

export const startServer = async (port = Number(process.env.PORT ?? 8080)): Promise<Server> => {
  const app = createApp();
  return await new Promise((resolve, reject) => {
    const server = app
      .listen(port, () => {
        console.log(`memory-svc listening on port ${port}`);
        resolve(server);
      })
      .on('error', (error: Error) => {
        reject(error);
      });
  });
};

if (require.main === module) {
  startServer().catch((error: unknown) => {
    console.error('Failed to start memory service', error);
    process.exit(1);
  });
}
