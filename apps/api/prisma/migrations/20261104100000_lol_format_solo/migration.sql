-- 롤 진행 방식에 솔랭내기(solo) 추가. 내전과 같이 밸런스·ELO를 쓰며 협곡에서만 고른다(API가 검증).
ALTER TYPE "lol_format" ADD VALUE 'solo';
