import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ActivityLogService } from './activity-log.service';
import { PrismaService } from '../prisma.service';
import { ActivityAction } from '@prisma/client';

describe('ActivityLogService', () => {
  let service: ActivityLogService;
  let prismaService: PrismaService;

  const mockPrismaClient = {
    activityLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const mockPrismaService = {
    activityLog: {
      create: jest.fn(),
    },
    getClient: jest.fn().mockReturnValue(mockPrismaClient),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivityLogService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<ActivityLogService>(ActivityLogService);
    prismaService = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('log', () => {
    it('should create an activity log entry', async () => {
      const logData = {
        tenantId: 'tenant1',
        userId: 'user1',
        action: ActivityAction.CREATE,
        entity: 'Product',
        entityId: 'product1',
        metadata: { name: 'Test Product' },
      };

      const expectedResult = {
        id: 'log1',
        ...logData,
        createdAt: new Date(),
      };

      mockPrismaService.activityLog.create.mockResolvedValue(expectedResult);

      const result = await service.log(logData);

      expect(mockPrismaService.activityLog.create).toHaveBeenCalledWith({
        data: {
          userId: logData.userId,
          action: logData.action,
          entity: logData.entity,
          entityId: logData.entityId,
          tenantId: logData.tenantId,
          metadata: logData.metadata,
        },
      });
      expect(result).toEqual(expectedResult);
    });

    it('should create log without entityId', async () => {
      const logData = {
        tenantId: 'tenant1',
        userId: 'user1',
        action: ActivityAction.CREATE,
        entity: 'Product',
      };

      mockPrismaService.activityLog.create.mockResolvedValue({ id: 'log1', ...logData });

      await service.log(logData);

      expect(mockPrismaService.activityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityId: undefined,
        }),
      });
    });

    it('should create log with empty metadata when not provided', async () => {
      const logData = {
        tenantId: 'tenant1',
        userId: 'user1',
        action: ActivityAction.UPDATE,
        entity: 'Product',
        entityId: 'product1',
      };

      mockPrismaService.activityLog.create.mockResolvedValue({ id: 'log1', ...logData });

      await service.log(logData);

      expect(mockPrismaService.activityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: {},
        }),
      });
    });
  });

  describe('findAll', () => {
    it('should return paginated activity logs', async () => {
      const tenantId = 'tenant1';
      const mockLogs = [
        {
          id: 'log1',
          action: ActivityAction.CREATE,
          entity: 'Product',
          user: { id: 'user1', username: 'admin', role: 'ADMIN' },
        },
        {
          id: 'log2',
          action: ActivityAction.UPDATE,
          entity: 'Product',
          user: { id: 'user2', username: 'staff', role: 'STAFF' },
        },
      ];

      mockPrismaClient.activityLog.findMany.mockResolvedValue(mockLogs);
      mockPrismaClient.activityLog.count.mockResolvedValue(2);

      const result = await service.findAll(tenantId, 0, 10);

      expect(prismaService.getClient).toHaveBeenCalledWith(tenantId);
      expect(mockPrismaClient.activityLog.findMany).toHaveBeenCalledWith({
        skip: 0,
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, username: true, role: true },
          },
        },
      });
      expect(result).toEqual({ data: mockLogs, total: 2 });
    });

    it('should use default take value of 50 when not provided', async () => {
      const tenantId = 'tenant1';
      mockPrismaClient.activityLog.findMany.mockResolvedValue([]);
      mockPrismaClient.activityLog.count.mockResolvedValue(0);

      await service.findAll(tenantId);

      expect(mockPrismaClient.activityLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
        }),
      );
    });

    it('should handle skip and take parameters', async () => {
      const tenantId = 'tenant1';
      mockPrismaClient.activityLog.findMany.mockResolvedValue([]);
      mockPrismaClient.activityLog.count.mockResolvedValue(100);

      await service.findAll(tenantId, 20, 30);

      expect(mockPrismaClient.activityLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 30,
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return a single activity log', async () => {
      const tenantId = 'tenant1';
      const logId = 'log1';
      const mockLog = {
        id: logId,
        action: ActivityAction.CREATE,
        entity: 'Product',
        user: { id: 'user1', username: 'admin', role: 'ADMIN' },
      };

      mockPrismaClient.activityLog.findFirst.mockResolvedValue(mockLog);

      const result = await service.findOne(logId, tenantId);

      expect(prismaService.getClient).toHaveBeenCalledWith(tenantId);
      expect(mockPrismaClient.activityLog.findFirst).toHaveBeenCalledWith({
        where: { id: logId },
        include: {
          user: {
            select: { id: true, username: true, role: true },
          },
        },
      });
      expect(result).toEqual(mockLog);
    });

    it('should throw NotFoundException when log not found', async () => {
      const tenantId = 'tenant1';
      const logId = 'nonexistent';

      mockPrismaClient.activityLog.findFirst.mockResolvedValue(null);

      await expect(service.findOne(logId, tenantId)).rejects.toThrow(NotFoundException);
      await expect(service.findOne(logId, tenantId)).rejects.toThrow(
        `Activity Log ${logId} not found`,
      );
    });
  });
});
