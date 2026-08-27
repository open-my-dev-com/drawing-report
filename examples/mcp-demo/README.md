# MCP Inspector 데모

이 예제는 MCP Inspector에서 SlipKit MCP 도구를 직접 호출하기 위한 작업공간입니다.

저장소 루트에서 다음 명령을 실행합니다. MCP 패키지를 빌드하고 샘플 파일을 준비한 뒤 Inspector를 엽니다.

```bash
pnpm demo:mcp
```

브라우저가 자동으로 열리지 않으면 터미널에 표시된 `http://localhost:6274` 주소로 접속합니다. 연결 화면에는 SlipKit 서버의 명령과 설정이 미리 입력되어 있습니다. **Connect**를 누른 뒤 **Tools**에서 도구를 호출할 수 있습니다.

## 확인 순서

1. `slip_list`를 빈 입력 `{}`으로 호출해 `sample-template.slip`을 확인합니다.
2. `slip_read`에 `{"path":"sample-template","part":"summary"}`를 입력해 페이지와 요소 목록을 읽습니다.
3. `slip_edit`에 `{"path":"sample-template","ops":[{"action":"set_element","id":"title","fields":{"content":"MCP 확인용 거래명세서"}}]}`를 입력해 제목을 수정합니다.
4. `slip_build_voucher`에 `{"templatePath":"sample-template","outPath":"sample-voucher","values":{"customerName":"테스트 고객","items":[{"name":"디자인 작업","amount":120000},{"name":"PDF 출력","amount":30000}]}}`를 입력합니다.
5. `slip_render_pdf`에 `{"path":"sample-voucher","outPath":"sample-output.pdf"}`를 입력합니다.
6. 생성된 PDF를 `examples/mcp-demo/workspace/sample-output.pdf`에서 확인합니다.

수정 내용과 생성 파일은 `examples/mcp-demo/workspace`에만 저장되며 Git에서 제외됩니다. 샘플을 초기 상태로 되돌리려면 Inspector를 종료하고 다음 명령을 실행합니다.

```bash
pnpm demo:mcp:reset
```

다음에 `pnpm demo:mcp`를 실행하면 초기 샘플이 다시 준비됩니다.
