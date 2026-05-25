import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService, HealthCheckResult } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './prisma.health';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: HealthCheckService;
  let prismaHealthIndicator: PrismaHealthIndicator;

  const mockHealthCheckResult: HealthCheckResult = {
    status: 'ok',
    info: {
      database: {
        status: 'up',
      },
    },
    error: {},
    details: {
      database: {
        status: 'up',
      },
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: {
            check: jest.fn(),
          },
        },
        {
          provide: PrismaHealthIndicator,
          useValue: {
            isHealthy: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    healthCheckService = module.get<HealthCheckService>(HealthCheckService);
    prismaHealthIndicator = module.get<PrismaHealthIndicator>(PrismaHealthIndicator);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('check', () => {
    it('should return health check result when healthy', async () => {
      jest.spyOn(healthCheckService, 'check').mockResolvedValue(mockHealthCheckResult);
      jest.spyOn(prismaHealthIndicator, 'isHealthy').mockResolvedValue({
        database: { status: 'up' },
      });

      const result = await controller.check();

      expect(result).toEqual(mockHealthCheckResult);
      expect(healthCheckService.check).toHaveBeenCalled();
    });

    it('should call prismaHealthIndicator.isHealthy', async () => {
      const isHealthySpy = jest
        .spyOn(prismaHealthIndicator, 'isHealthy')
        .mockResolvedValue({ database: { status: 'up' } });
      
      jest.spyOn(healthCheckService, 'check').mockImplementation(async (checks) => {
        // Execute the health check function
        await checks[0]();
        return mockHealthCheckResult;
      });

      await controller.check();

      expect(isHealthySpy).toHaveBeenCalledWith('database');
    });

    it('should return unhealthy status when database is down', async () => {
      const unhealthyResult: HealthCheckResult = {
        status: 'error',
        info: {},
        error: {
          database: {
            status: 'down',
            message: 'Database connection failed',
          },
        },
        details: {
          database: {
            status: 'down',
            message: 'Database connection failed',
          },
        },
      };

      jest.spyOn(healthCheckService, 'check').mockResolvedValue(unhealthyResult);
      jest.spyOn(prismaHealthIndicator, 'isHealthy').mockRejectedValue(new Error('DB Error'));

      const result = await controller.check();

      expect(result.status).toBe('error');
    });

    it('should handle health check errors gracefully', async () => {
      jest.spyOn(healthCheckService, 'check').mockRejectedValue(new Error('Health check failed'));

      await expect(controller.check()).rejects.toThrow('Health check failed');
    });
  });
});
