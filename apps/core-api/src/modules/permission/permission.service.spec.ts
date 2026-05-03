import { Test, TestingModule } from '@nestjs/testing';
import { PermissionService } from './permission.service';
import { ForbiddenException } from '@nestjs/common';

describe('PermissionService', () => {
  let service: PermissionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PermissionService],
    }).compile();
    service = module.get<PermissionService>(PermissionService);
  });

  describe('canAccess', () => {
    it('should allow wildcard permission', () => {
      expect(service.canAccess(['*'], 'object', 'read')).toBe(true);
    });

    it('should allow exact match', () => {
      expect(service.canAccess(['object.read'], 'object', 'read')).toBe(true);
    });

    it('should allow resource wildcard', () => {
      expect(service.canAccess(['object.*'], 'object', 'read')).toBe(true);
    });

    it('should deny when no matching permission', () => {
      expect(service.canAccess(['object.read'], 'object', 'write')).toBe(false);
    });

    it('should deny empty permissions', () => {
      expect(service.canAccess([], 'object', 'read')).toBe(false);
    });
  });

  describe('assertCanAccess', () => {
    it('should not throw when permitted', () => {
      expect(() => service.assertCanAccess(['*'], 'object', 'read')).not.toThrow();
    });

    it('should throw ForbiddenException when denied', () => {
      expect(() => service.assertCanAccess([], 'object', 'read')).toThrow(ForbiddenException);
    });
  });

  describe('filterFields', () => {
    it('should return all properties when user has wildcard', () => {
      const props = { name: 'Test', phone: '123', secret: 'hidden' };
      const result = service.filterFields(props, ['*']);
      expect(result).toEqual(props);
    });

    it('should return all properties when no field restrictions', () => {
      const props = { name: 'Test', phone: '123' };
      const result = service.filterFields(props, ['object.read']);
      expect(result).toEqual(props);
    });

    it('should filter fields when restrictions exist', () => {
      const props = { name: 'Test', phone: '123', secret: 'hidden' };
      const result = service.filterFields(props, ['object.read:name,phone']);
      expect(result).toEqual({ name: 'Test', phone: '123' });
    });
  });
});
