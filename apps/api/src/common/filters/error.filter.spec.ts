import { BadRequestException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { ErrorBody } from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import { AppError } from '../app-error';
import { toErrorResponse } from './error.filter';

describe('오류 필터 형식', () => {
  it('AppError → 코드·기본 상태·한국어 메시지', () => {
    const r = toErrorResponse(new AppError('NICKNAME_TAKEN'));
    expect(r.status).toBe(409);
    expect(ErrorBody.strict().parse(r.body)).toEqual({ code: 'NICKNAME_TAKEN', message: '이미 사용 중인 닉네임입니다.' });
  });

  it('상태를 덮어쓸 수 있다', () => {
    expect(toErrorResponse(new AppError('FORBIDDEN', 418)).status).toBe(418);
  });

  it('details는 VALIDATION_FAILED에서만', () => {
    const v = toErrorResponse(
      new AppError('VALIDATION_FAILED', undefined, { details: [{ path: 'nickname', message: 'x' }] }),
    );
    expect(v.body.details).toEqual([{ path: 'nickname', message: 'x' }]);
    const other = toErrorResponse(
      new AppError('FORBIDDEN', undefined, { details: [{ path: 'a', message: 'b' }] }),
    );
    expect(other.body).not.toHaveProperty('details');
  });

  it('Nest 내장 예외 → 계약 코드(내부 메시지 숨김)', () => {
    expect(toErrorResponse(new NotFoundException('Cannot GET /x'))).toEqual({
      status: 404,
      body: { code: 'NOT_FOUND', message: '찾을 수 없습니다.' },
    });
    expect(toErrorResponse(new BadRequestException('Unexpected token')).body.code).toBe('VALIDATION_FAILED');
    expect(toErrorResponse(new PayloadTooLargeException()).status).toBe(400);
  });

  it('body-parser 오류 객체 → VALIDATION_FAILED', () => {
    const err = Object.assign(new SyntaxError('bad json'), { status: 400, type: 'entity.parse.failed' });
    expect(toErrorResponse(err)).toEqual({
      status: 400,
      body: { code: 'VALIDATION_FAILED', message: '요청 형식이 올바르지 않습니다.' },
    });
  });

  it('예상 못한 예외 → 500 INTERNAL_ERROR, 원문 메시지 노출 안 함', () => {
    const r = toErrorResponse(new Error('db password is hunter2'));
    expect(r).toEqual({ status: 500, body: { code: 'INTERNAL_ERROR', message: '서버 오류가 발생했습니다.' } });
  });
});
