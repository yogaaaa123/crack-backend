import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UploadController } from './upload.controller';

describe('UploadController', () => {
  let controller: UploadController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UploadController],
    }).compile();

    controller = module.get<UploadController>(UploadController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('uploadImage', () => {
    it('should return file information when upload is successful', () => {
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'test-image.jpg',
        encoding: '7bit',
        mimetype: 'image/jpeg',
        size: 1024,
        destination: './uploads',
        filename: '1234567890-test.jpg',
        path: './uploads/1234567890-test.jpg',
        buffer: Buffer.from(''),
        stream: null as any,
      };

      const result = controller.uploadImage(mockFile);

      expect(result).toHaveProperty('filename');
      expect(result).toHaveProperty('originalname');
      expect(result).toHaveProperty('size');
      expect(result).toHaveProperty('mimetype');
      expect(result).toHaveProperty('url');
      expect(result.filename).toBe('1234567890-test.jpg');
      expect(result.originalname).toBe('test-image.jpg');
      expect(result.size).toBe(1024);
      expect(result.mimetype).toBe('image/jpeg');
      expect(result.url).toContain('/uploads/1234567890-test.jpg');
    });

    it('should throw BadRequestException when no file is uploaded', () => {
      expect(() => controller.uploadImage(undefined as any)).toThrow(BadRequestException);
      expect(() => controller.uploadImage(undefined as any)).toThrow('No file uploaded');
    });

    it('should include correct URL with BASE_URL from env', () => {
      const originalBaseUrl = process.env.BASE_URL;
      process.env.BASE_URL = 'https://api.example.com';

      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'test.jpg',
        encoding: '7bit',
        mimetype: 'image/jpeg',
        size: 1024,
        destination: './uploads',
        filename: 'test-123.jpg',
        path: './uploads/test-123.jpg',
        buffer: Buffer.from(''),
        stream: null as any,
      };

      const result = controller.uploadImage(mockFile);

      expect(result.url).toBe('https://api.example.com/uploads/test-123.jpg');

      process.env.BASE_URL = originalBaseUrl;
    });

    it('should use default localhost URL when BASE_URL is not set', () => {
      const originalBaseUrl = process.env.BASE_URL;
      const originalPort = process.env.PORT;
      delete process.env.BASE_URL;
      process.env.PORT = '3000';

      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'test.jpg',
        encoding: '7bit',
        mimetype: 'image/jpeg',
        size: 1024,
        destination: './uploads',
        filename: 'test-123.jpg',
        path: './uploads/test-123.jpg',
        buffer: Buffer.from(''),
        stream: null as any,
      };

      const result = controller.uploadImage(mockFile);

      expect(result.url).toBe('http://localhost:3000/uploads/test-123.jpg');

      process.env.BASE_URL = originalBaseUrl;
      process.env.PORT = originalPort;
    });

    it('should handle different image types', () => {
      const imageTypes = [
        { mimetype: 'image/jpeg', ext: 'jpg' },
        { mimetype: 'image/png', ext: 'png' },
        { mimetype: 'image/gif', ext: 'gif' },
        { mimetype: 'image/webp', ext: 'webp' },
      ];

      imageTypes.forEach(({ mimetype, ext }) => {
        const mockFile: Express.Multer.File = {
          fieldname: 'file',
          originalname: `test.${ext}`,
          encoding: '7bit',
          mimetype,
          size: 1024,
          destination: './uploads',
          filename: `test-123.${ext}`,
          path: `./uploads/test-123.${ext}`,
          buffer: Buffer.from(''),
          stream: null as any,
        };

        const result = controller.uploadImage(mockFile);
        expect(result.mimetype).toBe(mimetype);
      });
    });
  });
});
