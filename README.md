# OpenArmX 드럼 로봇 시뮬레이터

OpenArmX 양팔 로봇을 위한 드럼 타격 YAML 패턴 생성 시뮬레이터입니다.

## 실행 방법

```bash
python serve.py
```
브라우저에서 `http://localhost:8083/drum_simulator/` 접속

또는 `run.bat` 더블클릭

## 주요 기능

- 드럼 키트 구성 (위치·타입·팔 배정)
- 피아노 롤 타임라인으로 드럼 패턴 편집
- L/R 팔 독립 보간 애니메이션
- 수치 역기구학(IK)으로 TCP가 드럼 위치 정확히 도달
- 🎲 자동 패턴 생성 (5가지 스타일)
- YAML 내보내기 (ROS2 JointTrajectory 포맷)
- 씬 팔레트 (배경·로봇 컬러 변경)
