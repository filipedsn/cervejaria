# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: operational-session.spec.ts >> event.dashboard.read reveals and revokes event KPIs without changing command access
- Location: e2e\rbac-live\operational-session.spec.ts:1029:5

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('.dashboard-kpi-value')
Expected: 6
Received: 0
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" with timeout 5000ms
  - waiting for locator('.dashboard-kpi-value')
    14 × locator resolved to 0 elements
       - unexpected value "0"

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e6]:
      - heading "Eventos" [level=1] [ref=e7]
      - generic [ref=e8]:
        - button "Abrir alertas de pedidos" [ref=e9]
        - button "Abrir conta" [ref=e13]: OO
  - main [ref=e14]:
    - generic [ref=e15]:
      - generic [ref=e17]:
        - generic [ref=e18]:
          - generic [ref=e19]:
            - paragraph [ref=e20]: Ao vivo agora
            - heading "Foreign event QA 7068fb03a6e7" [level=2] [ref=e21]
            - paragraph [ref=e22]: 18:00 • QA
            - paragraph [ref=e23]: Foreign QA trailer 7068fb03a6e7
          - generic [ref=e24]: Aberto
        - generic [ref=e25]:
          - generic [ref=e26]:
            - paragraph [ref=e27]: Comandas abertas
            - paragraph [ref=e28]: "1"
          - generic [ref=e29]:
            - paragraph [ref=e30]: Comandas fechadas
            - paragraph [ref=e31]: "0"
          - generic [ref=e32]:
            - paragraph [ref=e33]: Vendas avulsas
            - paragraph [ref=e34]: "0"
          - generic [ref=e35]:
            - paragraph [ref=e36]: Receita avulsa
            - paragraph [ref=e37]: R$ 0,00
          - generic [ref=e38]:
            - paragraph [ref=e39]: Valor aberto
            - paragraph [ref=e40]: R$ 0,00
          - generic [ref=e41]:
            - paragraph [ref=e42]: Valor fechado
            - paragraph [ref=e43]: R$ 0,00
        - generic [ref=e44]:
          - button "Comandas" [ref=e45]
          - button "Editar cardápio do evento" [ref=e46]
          - button "Abrir QR Code para comandas" [ref=e51]
          - link "Ver ranking" [ref=e57] [cursor=pointer]:
            - /url: /ranking/cmv2n3vdw000phvdc6n4y22jo
        - button "Desfazer abertura" [ref=e63]
      - generic [ref=e64]:
        - paragraph [ref=e65]: Outubro de 2026
        - generic "Semanas da agenda" [ref=e66]:
          - list "Semana de 12/07/2026" [ref=e67]:
            - listitem "domingo, 12 de julho" [ref=e68]:
              - generic [ref=e69]: DOM
              - generic [ref=e70]: "12"
            - listitem "segunda-feira, 13 de julho" [ref=e71]:
              - generic [ref=e72]: SEG
              - generic [ref=e73]: "13"
            - listitem "terça-feira, 14 de julho" [ref=e74]:
              - generic [ref=e75]: TER
              - generic [ref=e76]: "14"
            - listitem "quarta-feira, 15 de julho" [ref=e77]:
              - generic [ref=e78]: QUA
              - generic [ref=e79]: "15"
            - listitem "quinta-feira, 16 de julho" [ref=e80]:
              - generic [ref=e81]: QUI
              - generic [ref=e82]: "16"
            - listitem "sexta-feira, 17 de julho" [ref=e83]:
              - generic [ref=e84]: SEX
              - generic [ref=e85]: "17"
            - listitem "sábado, 18 de julho" [ref=e86]:
              - generic [ref=e87]: SÁB
              - generic [ref=e88]: "18"
          - list "Semana de 19/07/2026" [ref=e89]:
            - listitem "domingo, 19 de julho" [ref=e90]:
              - generic [ref=e91]: DOM
              - generic [ref=e92]: "19"
            - listitem "segunda-feira, 20 de julho" [ref=e93]:
              - generic [ref=e94]: SEG
              - generic [ref=e95]: "20"
            - listitem "terça-feira, 21 de julho" [ref=e96]:
              - generic [ref=e97]: TER
              - generic [ref=e98]: "21"
            - listitem "quarta-feira, 22 de julho" [ref=e99]:
              - generic [ref=e100]: QUA
              - generic [ref=e101]: "22"
            - listitem "quinta-feira, 23 de julho" [ref=e102]:
              - generic [ref=e103]: QUI
              - generic [ref=e104]: "23"
            - listitem "sexta-feira, 24 de julho" [ref=e105]:
              - generic [ref=e106]: SEX
              - generic [ref=e107]: "24"
            - listitem "sábado, 25 de julho" [ref=e108]:
              - generic [ref=e109]: SÁB
              - generic [ref=e110]: "25"
          - list "Semana de 26/07/2026" [ref=e111]:
            - listitem "domingo, 26 de julho" [ref=e112]:
              - generic [ref=e113]: DOM
              - generic [ref=e114]: "26"
            - listitem "segunda-feira, 27 de julho" [ref=e115]:
              - generic [ref=e116]: SEG
              - generic [ref=e117]: "27"
            - listitem "terça-feira, 28 de julho" [ref=e118]:
              - generic [ref=e119]: TER
              - generic [ref=e120]: "28"
            - listitem "quarta-feira, 29 de julho" [ref=e121]:
              - generic [ref=e122]: QUA
              - generic [ref=e123]: "29"
            - listitem "quinta-feira, 30 de julho" [ref=e124]:
              - generic [ref=e125]: QUI
              - generic [ref=e126]: "30"
            - listitem "sexta-feira, 31 de julho" [ref=e127]:
              - generic [ref=e128]: SEX
              - generic [ref=e129]: "31"
            - listitem "sábado, 1 de agosto" [ref=e130]:
              - generic [ref=e131]: SÁB
              - generic [ref=e132]: "1"
          - list "Semana de 02/08/2026" [ref=e133]:
            - listitem "domingo, 2 de agosto" [ref=e134]:
              - generic [ref=e135]: DOM
              - generic [ref=e136]: "2"
            - listitem "segunda-feira, 3 de agosto" [ref=e137]:
              - generic [ref=e138]: SEG
              - generic [ref=e139]: "3"
            - listitem "terça-feira, 4 de agosto" [ref=e140]:
              - generic [ref=e141]: TER
              - generic [ref=e142]: "4"
            - listitem "quarta-feira, 5 de agosto" [ref=e143]:
              - generic [ref=e144]: QUA
              - generic [ref=e145]: "5"
            - listitem "quinta-feira, 6 de agosto" [ref=e146]:
              - generic [ref=e147]: QUI
              - generic [ref=e148]: "6"
            - listitem "sexta-feira, 7 de agosto" [ref=e149]:
              - generic [ref=e150]: SEX
              - generic [ref=e151]: "7"
            - listitem "sábado, 8 de agosto" [ref=e152]:
              - generic [ref=e153]: SÁB
              - generic [ref=e154]: "8"
          - list "Semana de 09/08/2026" [ref=e155]:
            - listitem "domingo, 9 de agosto" [ref=e156]:
              - generic [ref=e157]: DOM
              - generic [ref=e158]: "9"
            - listitem "segunda-feira, 10 de agosto" [ref=e159]:
              - generic [ref=e160]: SEG
              - generic [ref=e161]: "10"
            - listitem "terça-feira, 11 de agosto" [ref=e162]:
              - generic [ref=e163]: TER
              - generic [ref=e164]: "11"
            - listitem "quarta-feira, 12 de agosto" [ref=e165]:
              - generic [ref=e166]: QUA
              - generic [ref=e167]: "12"
            - listitem "quinta-feira, 13 de agosto" [ref=e168]:
              - generic [ref=e169]: QUI
              - generic [ref=e170]: "13"
            - listitem "sexta-feira, 14 de agosto" [ref=e171]:
              - generic [ref=e172]: SEX
              - generic [ref=e173]: "14"
            - listitem "sábado, 15 de agosto" [ref=e174]:
              - generic [ref=e175]: SÁB
              - generic [ref=e176]: "15"
          - list "Semana de 16/08/2026" [ref=e177]:
            - listitem "domingo, 16 de agosto" [ref=e178]:
              - generic [ref=e179]: DOM
              - generic [ref=e180]: "16"
            - listitem "segunda-feira, 17 de agosto" [ref=e181]:
              - generic [ref=e182]: SEG
              - generic [ref=e183]: "17"
            - listitem "terça-feira, 18 de agosto" [ref=e184]:
              - generic [ref=e185]: TER
              - generic [ref=e186]: "18"
            - listitem "quarta-feira, 19 de agosto" [ref=e187]:
              - generic [ref=e188]: QUA
              - generic [ref=e189]: "19"
            - listitem "quinta-feira, 20 de agosto" [ref=e190]:
              - generic [ref=e191]: QUI
              - generic [ref=e192]: "20"
            - listitem "sexta-feira, 21 de agosto" [ref=e193]:
              - generic [ref=e194]: SEX
              - generic [ref=e195]: "21"
            - listitem "sábado, 22 de agosto" [ref=e196]:
              - generic [ref=e197]: SÁB
              - generic [ref=e198]: "22"
          - list "Semana de 23/08/2026" [ref=e199]:
            - listitem "domingo, 23 de agosto" [ref=e200]:
              - generic [ref=e201]: DOM
              - generic [ref=e202]: "23"
            - listitem "segunda-feira, 24 de agosto" [ref=e203]:
              - generic [ref=e204]: SEG
              - generic [ref=e205]: "24"
            - listitem "terça-feira, 25 de agosto" [ref=e206]:
              - generic [ref=e207]: TER
              - generic [ref=e208]: "25"
            - listitem "quarta-feira, 26 de agosto" [ref=e209]:
              - generic [ref=e210]: QUA
              - generic [ref=e211]: "26"
            - listitem "quinta-feira, 27 de agosto" [ref=e212]:
              - generic [ref=e213]: QUI
              - generic [ref=e214]: "27"
            - listitem "sexta-feira, 28 de agosto" [ref=e215]:
              - generic [ref=e216]: SEX
              - generic [ref=e217]: "28"
            - listitem "sábado, 29 de agosto" [ref=e218]:
              - generic [ref=e219]: SÁB
              - generic [ref=e220]: "29"
          - list "Semana de 30/08/2026" [ref=e221]:
            - listitem "domingo, 30 de agosto" [ref=e222]:
              - generic [ref=e223]: DOM
              - generic [ref=e224]: "30"
            - listitem "segunda-feira, 31 de agosto" [ref=e225]:
              - generic [ref=e226]: SEG
              - generic [ref=e227]: "31"
            - listitem "terça-feira, 1 de setembro" [ref=e228]:
              - generic [ref=e229]: TER
              - generic [ref=e230]: "1"
            - listitem "quarta-feira, 2 de setembro" [ref=e231]:
              - generic [ref=e232]: QUA
              - generic [ref=e233]: "2"
            - listitem "quinta-feira, 3 de setembro" [ref=e234]:
              - generic [ref=e235]: QUI
              - generic [ref=e236]: "3"
            - listitem "sexta-feira, 4 de setembro" [ref=e237]:
              - generic [ref=e238]: SEX
              - generic [ref=e239]: "4"
            - listitem "sábado, 5 de setembro" [ref=e240]:
              - generic [ref=e241]: SÁB
              - generic [ref=e242]: "5"
          - list "Semana de 06/09/2026" [ref=e243]:
            - listitem "domingo, 6 de setembro" [ref=e244]:
              - generic [ref=e245]: DOM
              - generic [ref=e246]: "6"
            - listitem "segunda-feira, 7 de setembro" [ref=e247]:
              - generic [ref=e248]: SEG
              - generic [ref=e249]: "7"
            - listitem "terça-feira, 8 de setembro" [ref=e250]:
              - generic [ref=e251]: TER
              - generic [ref=e252]: "8"
            - listitem "quarta-feira, 9 de setembro" [ref=e253]:
              - generic [ref=e254]: QUA
              - generic [ref=e255]: "9"
            - listitem "quinta-feira, 10 de setembro" [ref=e256]:
              - generic [ref=e257]: QUI
              - generic [ref=e258]: "10"
            - listitem "sexta-feira, 11 de setembro" [ref=e259]:
              - generic [ref=e260]: SEX
              - generic [ref=e261]: "11"
            - listitem "sábado, 12 de setembro" [ref=e262]:
              - generic [ref=e263]: SÁB
              - generic [ref=e264]: "12"
          - list "Semana de 13/09/2026" [ref=e265]:
            - listitem "domingo, 13 de setembro" [ref=e266]:
              - generic [ref=e267]: DOM
              - generic [ref=e268]: "13"
            - listitem "segunda-feira, 14 de setembro" [ref=e269]:
              - generic [ref=e270]: SEG
              - generic [ref=e271]: "14"
            - listitem "terça-feira, 15 de setembro" [ref=e272]:
              - generic [ref=e273]: TER
              - generic [ref=e274]: "15"
            - listitem "quarta-feira, 16 de setembro" [ref=e275]:
              - generic [ref=e276]: QUA
              - generic [ref=e277]: "16"
            - listitem "quinta-feira, 17 de setembro" [ref=e278]:
              - generic [ref=e279]: QUI
              - generic [ref=e280]: "17"
            - listitem "sexta-feira, 18 de setembro" [ref=e281]:
              - generic [ref=e282]: SEX
              - generic [ref=e283]: "18"
            - listitem "sábado, 19 de setembro" [ref=e284]:
              - generic [ref=e285]: SÁB
              - generic [ref=e286]: "19"
          - list "Semana de 20/09/2026" [ref=e287]:
            - listitem "domingo, 20 de setembro" [ref=e288]:
              - generic [ref=e289]: DOM
              - generic [ref=e290]: "20"
            - listitem "segunda-feira, 21 de setembro" [ref=e291]:
              - generic [ref=e292]: SEG
              - generic [ref=e293]: "21"
            - listitem "terça-feira, 22 de setembro" [ref=e294]:
              - generic [ref=e295]: TER
              - generic [ref=e296]: "22"
            - listitem "quarta-feira, 23 de setembro" [ref=e297]:
              - generic [ref=e298]: QUA
              - generic [ref=e299]: "23"
            - listitem "quinta-feira, 24 de setembro" [ref=e300]:
              - generic [ref=e301]: QUI
              - generic [ref=e302]: "24"
            - listitem "sexta-feira, 25 de setembro" [ref=e303]:
              - generic [ref=e304]: SEX
              - generic [ref=e305]: "25"
            - listitem "sábado, 26 de setembro" [ref=e306]:
              - generic [ref=e307]: SÁB
              - generic [ref=e308]: "26"
          - list "Semana de 27/09/2026" [ref=e309]:
            - listitem "domingo, 27 de setembro" [ref=e310]:
              - generic [ref=e311]: DOM
              - generic [ref=e312]: "27"
            - listitem "segunda-feira, 28 de setembro" [ref=e313]:
              - generic [ref=e314]: SEG
              - generic [ref=e315]: "28"
            - listitem "terça-feira, 29 de setembro" [ref=e316]:
              - generic [ref=e317]: TER
              - generic [ref=e318]: "29"
            - listitem "quarta-feira, 30 de setembro" [ref=e319]:
              - generic [ref=e320]: QUA
              - generic [ref=e321]: "30"
            - listitem "quinta-feira, 1 de outubro" [ref=e322]:
              - generic [ref=e323]: QUI
              - generic [ref=e324]: "1"
            - listitem "sexta-feira, 2 de outubro" [ref=e325]:
              - generic [ref=e326]: SEX
              - generic [ref=e327]: "2"
            - listitem "sábado, 3 de outubro" [ref=e328]:
              - generic [ref=e329]: SÁB
              - generic [ref=e330]: "3"
          - list "Semana de 04/10/2026" [ref=e331]:
            - listitem "domingo, 4 de outubro" [ref=e332]:
              - generic [ref=e333]: DOM
              - generic [ref=e334]: "4"
            - listitem "segunda-feira, 5 de outubro" [ref=e335]:
              - generic [ref=e336]: SEG
              - generic [ref=e337]: "5"
            - listitem "terça-feira, 6 de outubro" [ref=e338]:
              - generic [ref=e339]: TER
              - generic [ref=e340]: "6"
            - listitem "quarta-feira, 7 de outubro" [ref=e341]:
              - generic [ref=e342]: QUA
              - generic [ref=e343]: "7"
            - listitem "quinta-feira, 8 de outubro" [ref=e344]:
              - generic [ref=e345]: QUI
              - generic [ref=e346]: "8"
            - listitem "sexta-feira, 9 de outubro" [ref=e347]:
              - generic [ref=e348]: SEX
              - generic [ref=e349]: "9"
            - listitem "sábado, 10 de outubro" [ref=e350]:
              - generic [ref=e351]: SÁB
              - generic [ref=e352]: "10"
          - list "Semana de 11/10/2026" [ref=e353]:
            - listitem "domingo, 11 de outubro" [ref=e354]:
              - generic [ref=e355]: DOM
              - generic [ref=e356]: "11"
            - listitem "segunda-feira, 12 de outubro" [ref=e357]:
              - generic [ref=e358]: SEG
              - generic [ref=e359]: "12"
            - listitem "terça-feira, 13 de outubro" [ref=e360]:
              - generic [ref=e361]: TER
              - generic [ref=e362]: "13"
            - listitem "quarta-feira, 14 de outubro" [ref=e363]:
              - generic [ref=e364]: QUA
              - generic [ref=e365]: "14"
            - listitem "quinta-feira, 15 de outubro" [ref=e366]:
              - generic [ref=e367]: QUI
              - generic [ref=e368]: "15"
            - listitem "sexta-feira, 16 de outubro" [ref=e369]:
              - generic [ref=e370]: SEX
              - generic [ref=e371]: "16"
            - listitem "sábado, 17 de outubro" [ref=e372]:
              - generic [ref=e373]: SÁB
              - generic [ref=e374]: "17"
          - list "Semana de 18/10/2026" [ref=e375]:
            - listitem "domingo, 18 de outubro" [ref=e376]:
              - generic [ref=e377]: DOM
              - generic [ref=e378]: "18"
            - listitem "segunda-feira, 19 de outubro" [ref=e379]:
              - generic [ref=e380]: SEG
              - generic [ref=e381]: "19"
            - listitem "terça-feira, 20 de outubro" [ref=e382]:
              - generic [ref=e383]: TER
              - generic [ref=e384]: "20"
            - listitem "quarta-feira, 21 de outubro" [ref=e385]:
              - generic [ref=e386]: QUA
              - generic [ref=e387]: "21"
            - listitem "quinta-feira, 22 de outubro" [ref=e388]:
              - generic [ref=e389]: QUI
              - generic [ref=e390]: "22"
            - listitem "sexta-feira, 23 de outubro" [ref=e391]:
              - generic [ref=e392]: SEX
              - generic [ref=e393]: "23"
            - listitem "sábado, 24 de outubro" [ref=e394]:
              - generic [ref=e395]: SÁB
              - generic [ref=e396]: "24"
          - list "Semana de 25/10/2026" [ref=e397]:
            - listitem "domingo, 25 de outubro" [ref=e398]:
              - generic [ref=e399]: DOM
              - generic [ref=e400]: "25"
            - listitem "segunda-feira, 26 de outubro" [ref=e401]:
              - generic [ref=e402]: SEG
              - generic [ref=e403]: "26"
            - listitem "terça-feira, 27 de outubro" [ref=e404]:
              - generic [ref=e405]: TER
              - generic [ref=e406]: "27"
            - listitem "quarta-feira, 28 de outubro" [ref=e407]:
              - generic [ref=e408]: QUA
              - generic [ref=e409]: "28"
            - listitem "quinta-feira, 29 de outubro" [ref=e410]:
              - generic [ref=e411]: QUI
              - generic [ref=e412]: "29"
            - listitem "sexta-feira, 30 de outubro" [ref=e413]:
              - generic [ref=e414]: SEX
              - generic [ref=e415]: "30"
            - listitem "sábado, 31 de outubro" [ref=e416]:
              - generic [ref=e417]: SÁB
              - generic [ref=e418]: "31"
          - list "Semana de 01/11/2026" [ref=e419]:
            - listitem "domingo, 1 de novembro" [ref=e420]:
              - generic [ref=e421]: DOM
              - generic [ref=e422]: "1"
            - listitem "segunda-feira, 2 de novembro" [ref=e423]:
              - generic [ref=e424]: SEG
              - generic [ref=e425]: "2"
            - listitem "terça-feira, 3 de novembro" [ref=e426]:
              - generic [ref=e427]: TER
              - generic [ref=e428]: "3"
            - listitem "quarta-feira, 4 de novembro" [ref=e429]:
              - generic [ref=e430]: QUA
              - generic [ref=e431]: "4"
            - listitem "quinta-feira, 5 de novembro" [ref=e432]:
              - generic [ref=e433]: QUI
              - generic [ref=e434]: "5"
            - listitem "sexta-feira, 6 de novembro" [ref=e435]:
              - generic [ref=e436]: SEX
              - generic [ref=e437]: "6"
            - listitem "sábado, 7 de novembro" [ref=e438]:
              - generic [ref=e439]: SÁB
              - generic [ref=e440]: "7"
          - list "Semana de 08/11/2026" [ref=e441]:
            - listitem "domingo, 8 de novembro" [ref=e442]:
              - generic [ref=e443]: DOM
              - generic [ref=e444]: "8"
            - listitem "segunda-feira, 9 de novembro" [ref=e445]:
              - generic [ref=e446]: SEG
              - generic [ref=e447]: "9"
            - listitem "terça-feira, 10 de novembro" [ref=e448]:
              - generic [ref=e449]: TER
              - generic [ref=e450]: "10"
            - listitem "quarta-feira, 11 de novembro" [ref=e451]:
              - generic [ref=e452]: QUA
              - generic [ref=e453]: "11"
            - listitem "quinta-feira, 12 de novembro" [ref=e454]:
              - generic [ref=e455]: QUI
              - generic [ref=e456]: "12"
            - listitem "sexta-feira, 13 de novembro" [ref=e457]:
              - generic [ref=e458]: SEX
              - generic [ref=e459]: "13"
            - listitem "sábado, 14 de novembro" [ref=e460]:
              - generic [ref=e461]: SÁB
              - generic [ref=e462]: "14"
          - list "Semana de 15/11/2026" [ref=e463]:
            - listitem "domingo, 15 de novembro" [ref=e464]:
              - generic [ref=e465]: DOM
              - generic [ref=e466]: "15"
            - listitem "segunda-feira, 16 de novembro" [ref=e467]:
              - generic [ref=e468]: SEG
              - generic [ref=e469]: "16"
            - listitem "terça-feira, 17 de novembro" [ref=e470]:
              - generic [ref=e471]: TER
              - generic [ref=e472]: "17"
            - listitem "quarta-feira, 18 de novembro" [ref=e473]:
              - generic [ref=e474]: QUA
              - generic [ref=e475]: "18"
            - listitem "quinta-feira, 19 de novembro" [ref=e476]:
              - generic [ref=e477]: QUI
              - generic [ref=e478]: "19"
            - listitem "sexta-feira, 20 de novembro" [ref=e479]:
              - generic [ref=e480]: SEX
              - generic [ref=e481]: "20"
            - listitem "sábado, 21 de novembro" [ref=e482]:
              - generic [ref=e483]: SÁB
              - generic [ref=e484]: "21"
          - list "Semana de 22/11/2026" [ref=e485]:
            - listitem "domingo, 22 de novembro" [ref=e486]:
              - generic [ref=e487]: DOM
              - generic [ref=e488]: "22"
            - listitem "segunda-feira, 23 de novembro" [ref=e489]:
              - generic [ref=e490]: SEG
              - generic [ref=e491]: "23"
            - listitem "terça-feira, 24 de novembro" [ref=e492]:
              - generic [ref=e493]: TER
              - generic [ref=e494]: "24"
            - listitem "quarta-feira, 25 de novembro" [ref=e495]:
              - generic [ref=e496]: QUA
              - generic [ref=e497]: "25"
            - listitem "quinta-feira, 26 de novembro" [ref=e498]:
              - generic [ref=e499]: QUI
              - generic [ref=e500]: "26"
            - listitem "sexta-feira, 27 de novembro" [ref=e501]:
              - generic [ref=e502]: SEX
              - generic [ref=e503]: "27"
            - listitem "sábado, 28 de novembro" [ref=e504]:
              - generic [ref=e505]: SÁB
              - generic [ref=e506]: "28"
          - list "Semana de 29/11/2026" [ref=e507]:
            - listitem "domingo, 29 de novembro" [ref=e508]:
              - generic [ref=e509]: DOM
              - generic [ref=e510]: "29"
            - listitem "segunda-feira, 30 de novembro" [ref=e511]:
              - generic [ref=e512]: SEG
              - generic [ref=e513]: "30"
            - listitem "terça-feira, 1 de dezembro" [ref=e514]:
              - generic [ref=e515]: TER
              - generic [ref=e516]: "1"
            - listitem "quarta-feira, 2 de dezembro" [ref=e517]:
              - generic [ref=e518]: QUA
              - generic [ref=e519]: "2"
            - listitem "quinta-feira, 3 de dezembro" [ref=e520]:
              - generic [ref=e521]: QUI
              - generic [ref=e522]: "3"
            - listitem "sexta-feira, 4 de dezembro" [ref=e523]:
              - generic [ref=e524]: SEX
              - generic [ref=e525]: "4"
            - listitem "sábado, 5 de dezembro" [ref=e526]:
              - generic [ref=e527]: SÁB
              - generic [ref=e528]: "5"
          - list "Semana de 06/12/2026" [ref=e529]:
            - listitem "domingo, 6 de dezembro" [ref=e530]:
              - generic [ref=e531]: DOM
              - generic [ref=e532]: "6"
            - listitem "segunda-feira, 7 de dezembro" [ref=e533]:
              - generic [ref=e534]: SEG
              - generic [ref=e535]: "7"
            - listitem "terça-feira, 8 de dezembro" [ref=e536]:
              - generic [ref=e537]: TER
              - generic [ref=e538]: "8"
            - listitem "quarta-feira, 9 de dezembro" [ref=e539]:
              - generic [ref=e540]: QUA
              - generic [ref=e541]: "9"
            - listitem "quinta-feira, 10 de dezembro" [ref=e542]:
              - generic [ref=e543]: QUI
              - generic [ref=e544]: "10"
            - listitem "sexta-feira, 11 de dezembro" [ref=e545]:
              - generic [ref=e546]: SEX
              - generic [ref=e547]: "11"
            - listitem "sábado, 12 de dezembro" [ref=e548]:
              - generic [ref=e549]: SÁB
              - generic [ref=e550]: "12"
          - list "Semana de 13/12/2026" [ref=e551]:
            - listitem "domingo, 13 de dezembro" [ref=e552]:
              - generic [ref=e553]: DOM
              - generic [ref=e554]: "13"
            - listitem "segunda-feira, 14 de dezembro" [ref=e555]:
              - generic [ref=e556]: SEG
              - generic [ref=e557]: "14"
            - listitem "terça-feira, 15 de dezembro" [ref=e558]:
              - generic [ref=e559]: TER
              - generic [ref=e560]: "15"
            - listitem "quarta-feira, 16 de dezembro" [ref=e561]:
              - generic [ref=e562]: QUA
              - generic [ref=e563]: "16"
            - listitem "quinta-feira, 17 de dezembro" [ref=e564]:
              - generic [ref=e565]: QUI
              - generic [ref=e566]: "17"
            - listitem "sexta-feira, 18 de dezembro" [ref=e567]:
              - generic [ref=e568]: SEX
              - generic [ref=e569]: "18"
            - listitem "sábado, 19 de dezembro" [ref=e570]:
              - generic [ref=e571]: SÁB
              - generic [ref=e572]: "19"
          - list "Semana de 20/12/2026" [ref=e573]:
            - listitem "domingo, 20 de dezembro" [ref=e574]:
              - generic [ref=e575]: DOM
              - generic [ref=e576]: "20"
            - listitem "segunda-feira, 21 de dezembro" [ref=e577]:
              - generic [ref=e578]: SEG
              - generic [ref=e579]: "21"
            - listitem "terça-feira, 22 de dezembro" [ref=e580]:
              - generic [ref=e581]: TER
              - generic [ref=e582]: "22"
            - listitem "quarta-feira, 23 de dezembro" [ref=e583]:
              - generic [ref=e584]: QUA
              - generic [ref=e585]: "23"
            - listitem "quinta-feira, 24 de dezembro" [ref=e586]:
              - generic [ref=e587]: QUI
              - generic [ref=e588]: "24"
            - listitem "sexta-feira, 25 de dezembro" [ref=e589]:
              - generic [ref=e590]: SEX
              - generic [ref=e591]: "25"
            - listitem "sábado, 26 de dezembro" [ref=e592]:
              - generic [ref=e593]: SÁB
              - generic [ref=e594]: "26"
          - list "Semana de 27/12/2026" [ref=e595]:
            - listitem "domingo, 27 de dezembro" [ref=e596]:
              - generic [ref=e597]: DOM
              - generic [ref=e598]: "27"
            - listitem "segunda-feira, 28 de dezembro" [ref=e599]:
              - generic [ref=e600]: SEG
              - generic [ref=e601]: "28"
            - listitem "terça-feira, 29 de dezembro" [ref=e602]:
              - generic [ref=e603]: TER
              - generic [ref=e604]: "29"
            - listitem "quarta-feira, 30 de dezembro" [ref=e605]:
              - generic [ref=e606]: QUA
              - generic [ref=e607]: "30"
            - listitem "quinta-feira, 31 de dezembro" [ref=e608]:
              - generic [ref=e609]: QUI
              - generic [ref=e610]: "31"
            - listitem "sexta-feira, 1 de janeiro" [ref=e611]:
              - generic [ref=e612]: SEX
              - generic [ref=e613]: "1"
            - listitem "sábado, 2 de janeiro" [ref=e614]:
              - generic [ref=e615]: SÁB
              - generic [ref=e616]: "2"
      - button "Novo compromisso Adicionar item" [ref=e617]
      - generic [ref=e618]:
        - heading "Hoje, 10 de Outubro" [level=2] [ref=e619]
        - paragraph [ref=e620]: Nenhum outro compromisso nesta data
  - navigation "Navegação principal" [ref=e621]:
    - generic [ref=e622]:
      - link "Eventos" [ref=e623] [cursor=pointer]:
        - /url: /eventos
      - link "Comandas" [ref=e628] [cursor=pointer]:
        - /url: /comandas
      - link "Clientes" [ref=e634] [cursor=pointer]:
        - /url: /clientes
      - link "Cardápio" [ref=e640] [cursor=pointer]:
        - /url: /operacao/catalogo
      - link "Dashboard" [ref=e645] [cursor=pointer]:
        - /url: /dashboard
      - link "Config." [ref=e649] [cursor=pointer]:
        - /url: /configuracoes
```

# Test source

```ts
  962  |   await ownerContext.addCookies([{ name: 'token', value: eventMenuOwnerCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  963  |   await owner.goto('/eventos');
  964  |   const ownerMe = await ownerContext.request.get('/api/auth/me');
  965  |   expect(ownerMe.status()).toBe(200);
  966  |   const ownerTenantId = (await ownerMe.json()).cervejaria.id;
  967  |   const menuUrl = `/api/eventos/${eventMenuEventId}/cardapio`;
  968  |   const beforeResponse = await ownerContext.request.get(menuUrl);
  969  |   expect(beforeResponse.status(), await beforeResponse.text()).toBe(200);
  970  |   const before = await beforeResponse.json();
  971  |   expect(before.produtoIds).toEqual([]);
  972  |   const adminUrl = `/api/usuarios/${eventMenuStaffId}/permissoes-operacao`;
  973  |   const setMenuPermissions = async (permissoesOperacao: string[]) => {
  974  |     const response = await ownerContext.request.patch(adminUrl, { data: { permissoesOperacao } });
  975  |     expect(response.status(), await response.text()).toBe(200);
  976  |   };
  977  |   await setMenuPermissions([]);
  978  | 
  979  |   const staffContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  980  |   const staff = await staffContext.newPage();
  981  |   await staffContext.addCookies([{ name: 'token', value: eventMenuStaffCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  982  |   const modeContext = await staffContext.request.get('/api/operacao/contexto');
  983  |   expect(modeContext.status(), await modeContext.text()).toBe(200);
  984  |   const mode = await modeContext.json();
  985  |   expect(mode.operationMode).toBe('EVENTO');
  986  |   expect(mode.operationalSettingsSource).toBe('LEGACY');
  987  |   await staff.goto('/eventos');
  988  |   const disabledStaffMe = await (await staffContext.request.get('/api/auth/me')).json();
  989  |   expect(disabledStaffMe.usuario.permissoesOperacao).toEqual([]);
  990  |   expect(disabledStaffMe.cervejaria.id).toBe(ownerTenantId);
  991  |   const eventCard = staff.locator('.card').filter({ hasText: eventMenuEventName }).first();
  992  |   await expect(eventCard).toBeVisible();
  993  |   await expect(eventCard.locator('button[aria-label*="card"]')).toHaveCount(0);
  994  |   const denied = await staffContext.request.put(menuUrl, { data: { produtoIds: [eventMenuForeignProductId] } });
  995  |   expect([401, 403]).toContain(denied.status());
  996  |   expect(await (await ownerContext.request.get(menuUrl)).json()).toEqual(before);
  997  | 
  998  |   await setMenuPermissions(['event.menu.manage']);
  999  |   await staff.reload();
  1000 |   expect((await (await staffContext.request.get('/api/auth/me')).json()).usuario.permissoesOperacao).toEqual(['event.menu.manage']);
  1001 |   const grantedCard = staff.locator('.card').filter({ hasText: eventMenuEventName }).first();
  1002 |   const editorButton = grantedCard.locator('button[aria-label*="card"]');
  1003 |   await expect(editorButton).toHaveCount(1);
  1004 |   await editorButton.click();
  1005 |   const dialog = staff.getByRole('dialog');
  1006 |   await expect(dialog).toBeVisible();
  1007 |   await dialog.getByRole('button', { name: /Montar manual/ }).click();
  1008 |   await expect(dialog.getByText(eventMenuForeignProductName, { exact: true })).toBeVisible();
  1009 |   await dialog.locator('label').filter({ hasText: eventMenuForeignProductName }).locator('input[type="checkbox"]').check();
  1010 |   const savePromise = staff.waitForResponse((response) => new URL(response.url()).pathname === menuUrl && response.request().method() === 'PUT');
  1011 |   await dialog.getByRole('button', { name: /Salvar card/ }).click();
  1012 |   const saved = await savePromise;
  1013 |   expect(saved.status(), await saved.text()).toBe(200);
  1014 |   const afterGrant = await (await ownerContext.request.get(menuUrl)).json();
  1015 |   expect(afterGrant.produtoIds).toEqual([eventMenuForeignProductId]);
  1016 |   expect(afterGrant.produtos.map((produto: { id: string }) => produto.id)).toEqual([eventMenuForeignProductId]);
  1017 | 
  1018 |   await setMenuPermissions([]);
  1019 |   await staff.reload();
  1020 |   const revokedCard = staff.locator('.card').filter({ hasText: eventMenuEventName }).first();
  1021 |   await expect(revokedCard.locator('button[aria-label*="card"]')).toHaveCount(0);
  1022 |   const revoked = await staffContext.request.put(menuUrl, { data: { produtoIds: [] } });
  1023 |   expect([401, 403]).toContain(revoked.status());
  1024 |   expect(await (await ownerContext.request.get(menuUrl)).json()).toEqual(afterGrant);
  1025 |   console.log('RBAC_LIVE_REGRESSION key=event.menu.manage; dependency=none; disabled=editor-hidden-and-direct-write-denied-no-mutation; enabled=real-ui-menu-change-persisted; revoked=same-session-editor-hidden-and-direct-write-denied; event-mode=LEGACY; result=PASS');
  1026 |   await Promise.all([ownerContext.close(), staffContext.close()]);
  1027 | });
  1028 | 
  1029 | test('event.dashboard.read reveals and revokes event KPIs without changing command access', async ({ browser }) => {
  1030 |   const ownerContext = await browser.newContext();
  1031 |   const owner = await ownerContext.newPage();
  1032 |   await ownerContext.addCookies([{ name: 'token', value: eventMenuOwnerCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  1033 |   await owner.goto('/eventos');
  1034 |   const permissionApiForEventStaff = `/api/usuarios/${eventMenuStaffId}/permissoes-operacao`;
  1035 |   const setEventStaffPermissions = async (permissoesOperacao: string[]) => {
  1036 |     const response = await ownerContext.request.patch(permissionApiForEventStaff, { data: { permissoesOperacao } });
  1037 |     expect(response.status(), await response.text()).toBe(200);
  1038 |   };
  1039 |   const dashboardUrl = `/api/eventos/${eventMenuEventId}/dashboard`;
  1040 |   const baselineResponse = await ownerContext.request.get(dashboardUrl);
  1041 |   expect(baselineResponse.status(), await baselineResponse.text()).toBe(200);
  1042 |   const baseline = await baselineResponse.json();
  1043 |   await setEventStaffPermissions(['command.read']);
  1044 | 
  1045 |   const staffContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  1046 |   const staff = await staffContext.newPage();
  1047 |   await staffContext.addCookies([{ name: 'token', value: eventMenuStaffCookie.replace(/^token=/, ''), url: process.env.RBAC_QA_BASE_URL! }]);
  1048 |   const modeResponse = await staffContext.request.get('/api/operacao/contexto');
  1049 |   expect(modeResponse.status(), await modeResponse.text()).toBe(200);
  1050 |   const mode = await modeResponse.json();
  1051 |   expect(mode.operationMode).toBe('EVENTO');
  1052 |   expect(mode.operationalSettingsSource).toBe('LEGACY');
  1053 |   const disabledMe = await (await staffContext.request.get('/api/auth/me')).json();
  1054 |   expect(disabledMe.usuario.permissoesOperacao).toEqual(['command.read']);
  1055 |   const deniedDashboard = await staffContext.request.get(dashboardUrl);
  1056 |   expect([401, 403]).toContain(deniedDashboard.status());
  1057 |   const disabledCommands = await staffContext.request.get(`/api/comandas/evento/${eventMenuEventId}?status=ABERTA`);
  1058 |   expect(disabledCommands.status(), await disabledCommands.text()).toBe(200);
  1059 |   await staff.goto('/eventos');
  1060 |   await expect.poll(() => new URL(staff.url()).pathname).toBe('/eventos');
  1061 |   const dashboardValues = staff.locator('.dashboard-kpi-value');
> 1062 |   await expect(dashboardValues).toHaveCount(6);
       |                                 ^ Error: expect(locator).toHaveCount(expected) failed
  1063 |   await expect(dashboardValues).toHaveText(Array(6).fill('—'));
  1064 | 
  1065 |   await setEventStaffPermissions(['command.read', 'event.dashboard.read']);
  1066 |   await staff.reload();
  1067 |   expect((await (await staffContext.request.get('/api/auth/me')).json()).usuario.permissoesOperacao).toEqual(['command.read', 'event.dashboard.read']);
  1068 |   const grantedDashboard = await staffContext.request.get(dashboardUrl);
  1069 |   expect(grantedDashboard.status(), await grantedDashboard.text()).toBe(200);
  1070 |   expect(await grantedDashboard.json()).toEqual(baseline);
  1071 |   await expect(dashboardValues).toHaveCount(6);
  1072 |   await expect(dashboardValues.first()).not.toHaveText('—');
  1073 | 
  1074 |   await setEventStaffPermissions(['command.read']);
  1075 |   await staff.reload();
  1076 |   const revokedDashboard = await staffContext.request.get(dashboardUrl);
  1077 |   expect([401, 403]).toContain(revokedDashboard.status());
  1078 |   const commandAccessAfterRevoke = await staffContext.request.get(`/api/comandas/evento/${eventMenuEventId}?status=ABERTA`);
  1079 |   expect(commandAccessAfterRevoke.status(), await commandAccessAfterRevoke.text()).toBe(200);
  1080 |   await expect(dashboardValues).toHaveCount(6);
  1081 |   await expect(dashboardValues).toHaveText(Array(6).fill('—'));
  1082 |   console.log('RBAC_LIVE_REGRESSION key=event.dashboard.read; dependency=command.read retained; disabled=event-dashboard-api-denied-kpis-hidden-command-read-works; enabled=event-kpis-visible-and-api-projection-matches-owner; revoked=same-session-kpis-hidden-dashboard-denied-command-read-remains; event-mode=LEGACY; result=PASS');
  1083 |   await Promise.all([ownerContext.close(), staffContext.close()]);
  1084 | });
  1085 | 
```