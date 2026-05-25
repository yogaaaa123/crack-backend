import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma.service';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');

describe('AdminService', () => {
  let service: AdminService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    tenant: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    tenantUser: {
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    product: {
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    category: {
      updateMany: jest.fn(),
    },
    supplier: {
      updateMany: jest.fn(),
    },
    salesOrder: {
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    purchaseOrder: {
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    salesReturn: {
      count: jest.fn(),
    },
    platformAdmin: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
    prismaService = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAllTenants', () => {
    it('should return paginated tenants with stats', async () => {
      const mockTenants = [
        {
          id: 'tenant1',
          name: 'Store 1',
          slug: 'store-1',
          createdAt: new Date(),
          _count: {
            users: 5,
            products: 100,
            salesOrders: 50,
            purchaseOrders: 30,
          },
        },
      ];

      mockPrismaService.tenant.findMany.mockResolvedValue(mockTenants);
      mockPrismaService.tenant.count.mockResolvedValue(1);

      const result = await service.findAllTenants(0, 10);

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toHaveProperty('stats');
      expect(result.data[0].stats.totalUsers).toBe(5);
      expect(result.total).toBe(1);
    });

    it('should use default pagination values', async () => {
      mockPrismaService.tenant.findMany.mockResolvedValue([]);
      mockPrismaService.tenant.count.mockResolvedValue(0);

      await service.findAllTenants();

      expect(mockPrismaService.tenant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 50,
        }),
      );
    });
  });

  describe('findTenantById', () => {
    it('should return tenant details with stats', async () => {
      const mockTenant = {
        id: 'tenant1',
        name: 'Store 1',
        slug: 'store-1',
        createdAt: new Date(),
        _count: {
          users: 5,
          products: 100,
          categories: 10,
          suppliers: 8,
          salesOrders: 50,
          purchaseOrders: 30,
          returns: 5,
          stockTransactions: 200,
        },
        members: [
          {
            role: 'OWNER',
            platformUser: { email: 'owner@test.com', name: 'Owner' },
          },
        ],
      };

      mockPrismaService.tenant.findFirst.mockResolvedValue(mockTenant);

      const result = await service.findTenantById('tenant1');

      expect(result.id).toBe('tenant1');
      expect(result.stats.totalUsers).toBe(5);
      expect(result.owners).toHaveLength(1);
    });

    it('should throw NotFoundException when tenant not found', async () => {
      mockPrismaService.tenant.findFirst.mockResolvedValue(null);

      await expect(service.findTenantById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeTenant', () => {
    it('should soft delete tenant and related data', async () => {
      const mockTenant = {
        id: 'tenant1',
        name: 'Store 1',
      };

      mockPrismaService.tenant.findFirst.mockResolvedValue(mockTenant);
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        return callback(mockPrismaService);
      });

      const result = await service.removeTenant('tenant1');

      expect(result.message).toContain('berhasil dihapus');
      expect(result.id).toBe('tenant1');
    });

    it('should throw NotFoundException when tenant not found', async () => {
      mockPrismaService.tenant.findFirst.mockResolvedValue(null);

      await expect(service.removeTenant('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPlatformStats', () => {
    it('should return platform-wide statistics', async () => {
      mockPrismaService.tenant.count.mockResolvedValue(10);
      mockPrismaService.tenantUser.count.mockResolvedValue(50);
      mockPrismaService.product.count.mockResolvedValue(500);
      mockPrismaService.salesOrder.count.mockResolvedValue(200);
      mockPrismaService.purchaseOrder.count.mockResolvedValue(150);
      mockPrismaService.salesReturn.count.mockResolvedValue(20);

      const result = await service.getPlatformStats();

      expect(result.platform.totalTenants).toBe(10);
      expect(result.platform.totalUsers).toBe(50);
      expect(result.platform.totalProducts).toBe(500);
    });
  });

  describe('login', () => {
    it('should return admin data when credentials are valid', async () => {
      const mockAdmin = {
        id: 'admin1',
        email: 'admin@test.com',
        name: 'Admin',
        passwordHash: 'hashedpassword',
      };

      mockPrismaService.platformAdmin.findFirst.mockResolvedValue(mockAdmin);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login('admin@test.com', 'password');

      expect(result.email).toBe('admin@test.com');
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('should throw NotFoundException when admin not found', async () => {
      mockPrismaService.platformAdmin.findFirst.mockResolvedValue(null);

      await expect(service.login('nonexistent@test.com', 'password')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when password is invalid', async () => {
      const mockAdmin = {
        id: 'admin1',
        email: 'admin@test.com',
        passwordHash: 'hashedpassword',
      };

      mockPrismaService.platformAdmin.findFirst.mockResolvedValue(mockAdmin);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login('admin@test.com', 'wrongpassword')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
