import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';

const dto: CreateUserDto = {
  email: 'jane@example.com',
  name: 'Jane Doe',
  accountNumber: '0123456789',
  bankCode: '044',
};

function uniqueConstraintError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`email`)',
    { code: 'P2002', clientVersion: 'test' },
  );
}

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: { create: jest.Mock; findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      user: { create: jest.fn(), findUnique: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(UsersService);
  });

  describe('create', () => {
    it('creates the user when the email is not already taken', async () => {
      prisma.user.create.mockResolvedValue({ id: 'user-1', ...dto });

      const user = await service.create(dto);

      expect(user).toEqual({ id: 'user-1', ...dto });
    });

    it('throws ConflictException when the email is already taken', async () => {
      prisma.user.create.mockRejectedValue(uniqueConstraintError());

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('rethrows any other error unchanged', async () => {
      prisma.user.create.mockRejectedValue(new Error('connection refused'));

      await expect(service.create(dto)).rejects.toThrow('connection refused');
    });
  });

  describe('findById', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findById('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
