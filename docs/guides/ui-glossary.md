# UI glossary

## Purpose

The words every locale uses for Canopi's core terms. A term keeps one translation across the whole interface: tool names, panel names, menus, dialogs, empty states and accessible names. Key and format rules are in [frontend rules](frontend.md#rules).

## Rules

- English is sentence case; capitalise the first word, proper nouns and Canopi's product terms only. Design is always capitalised as the product term. A sentence that names a panel keeps its name as written ("Open in the Data library"). Enforced by `i18n-copy.test.ts`.
- Placeholders fit their field in every locale: 34 units in a dock search field, 26 in the title-bar place field, CJK and Hangul characters counting 2. Enforced by `i18n-copy.test.ts`.
- Buttons that open a picker or dialog end with one ellipsis character ("Import stamps…"); import and export buttons name what they move (advice).
- Species names come from the catalog as they are. A species with no name in the interface language shows its English name with the localized mark (`speciesName.englishMark`) and an accessible explanation (advice; the rendering is in `components/shared/SpeciesIdentity.tsx`).
- One form of address per locale, never mixed: fr *vous*, de *Sie*, ru *вы*, es *tú*, it *tu*, nl *je*, pt (Brazilian) *você* (advice).
- The tables below are the authority when a locale disagrees with itself. Only the French stamp term (*tampon*, never *planche*) has a test (`i18n-completeness.test.ts`); the rest is reviewed by hand, so check new keys against the table (advice).

## Core terms

| English | fr | es | pt | it | de |
| --- | --- | --- | --- | --- | --- |
| Design | Design | diseño | design | progetto | Design |
| map | carte | mapa | mapa | mappa | Karte |
| zone | zone | zona | zona | zona | Zone |
| plant | plante | planta | planta | pianta | Pflanze |
| species | espèce | especie | espécie | specie | Art |
| stratum | strate | estrato | estrato | strato | Schicht |
| consortium | consortium | consorcio | consórcio | consorzio | Konsortium |
| stamp | tampon | sello | carimbo | timbro | Stempel |
| Saved stamps | Tampons enregistrés | Sellos guardados | Carimbos salvos | Timbri salvati | Gespeicherte Stempel |
| Favorites | Favoris | Favoritos | Favoritos | Preferiti | Favoriten |
| Plant catalog | Catalogue des plantes | Catálogo de plantas | Catálogo de plantas | Catalogo delle piante | Pflanzenkatalog |
| Data library | Bibliothèque de données | Biblioteca de datos | Biblioteca de dados | Libreria dati | Datenbibliothek |
| layer | calque | capa | camada | livello | Ebene |
| saved view | vue enregistrée | vista guardada | visualização salva | vista salvata | gespeicherte Ansicht |
| story | récit | relato | história | racconto | Geschichte |

| English | nl | ru | zh | ja | ko |
| --- | --- | --- | --- | --- | --- |
| Design | ontwerp | проект | 设计 | デザイン | 디자인 |
| map | kaart | карта | 地图 | 地図 | 지도 |
| zone | zone | зона | 区域 | ゾーン | 구역 |
| plant | plant | растение | 植物 | 植物 | 식물 |
| species | soort | вид | 物种 | 種 | 종 |
| stratum | etage | ярус | 层次 | 階層 | 층위 |
| consortium | consortium | консорциум | 联合体 | コンソーシアム | 컨소시엄 |
| stamp | stempel | штамп | 图章 | スタンプ | 스탬프 |
| Saved stamps | Opgeslagen stempels | Сохранённые штампы | 已保存图章 | 保存済みスタンプ | 저장된 스탬프 |
| Favorites | Favorieten | Избранное | 收藏 | お気に入り | 즐겨찾기 |
| Plant catalog | Plantencatalogus | Каталог растений | 植物目录 | 植物カタログ | 식물 카탈로그 |
| Data library | Databibliotheek | Библиотека данных | 数据资料库 | データライブラリ | 데이터 라이브러리 |
| layer | laag | слой | 图层 | レイヤー | 레이어 |
| saved view | opgeslagen weergave | сохранённый вид | 已保存的视图 | 保存したビュー | 저장한 보기 |
| story | verhaal | история | 故事 | ストーリー | 이야기 |

## Tool and panel names

Tool names are the `canvas.tools.*` keys and panel names the `panelRail.*` keys in `desktop/web/src/i18n/`; every other string that names a tool or panel uses the same words.

| English | fr | es | pt | it | de |
| --- | --- | --- | --- | --- | --- |
| Select | Sélection | Seleccionar | Selecionar | Seleziona | Auswählen |
| Pan | Déplacer la vue | Desplazar | Mover a vista | Sposta la vista | Verschieben |
| Place plants | Placer des plantes | Colocar plantas | Colocar plantas | Colloca piante | Pflanzen setzen |
| Plant a row | Planter une rangée | Plantar una fila | Plantar uma fileira | Pianta un filare | Eine Reihe pflanzen |
| Place a stamp | Placer un tampon | Colocar un sello | Colocar um carimbo | Colloca un timbro | Stempel setzen |
| Zones | Zones | Zonas | Zonas | Zone | Zonen |
| Text note | Note texte | Nota de texto | Nota de texto | Nota di testo | Textnotiz |
| Measure | Mesurer | Medir | Medir | Misura | Messen |
| Layers | Calques | Capas | Camadas | Livelli | Ebenen |
| Plants in this Design | Plantes de ce Design | Plantas de este diseño | Plantas deste design | Piante di questo progetto | Pflanzen in diesem Design |
| Favorites and stamps | Favoris et tampons | Favoritos y sellos | Favoritos e carimbos | Preferiti e timbri | Favoriten und Stempel |
| Calendar | Calendrier | Calendario | Calendário | Calendario | Kalender |
| Budget | Budget | Presupuesto | Orçamento | Budget | Budget |
| Design notebook | Carnet de Designs | Cuaderno de diseños | Caderno de designs | Quaderno dei progetti | Design-Notizbuch |
| Stories | Récits | Relatos | Histórias | Racconti | Geschichten |

| English | nl | ru | zh | ja | ko |
| --- | --- | --- | --- | --- | --- |
| Select | Selecteren | Выделение | 选择 | 選択 | 선택 |
| Pan | Pannen | Панорама | 平移 | パン | 이동 |
| Place plants | Planten plaatsen | Разместить растения | 放置植物 | 植物を配置 | 식물 배치 |
| Plant a row | Een rij planten | Посадить ряд | 种一行 | 列に植える | 한 줄 심기 |
| Place a stamp | Stempel plaatsen | Поставить штамп | 放置图章 | スタンプを配置 | 스탬프 배치 |
| Zones | Zones | Зоны | 区域 | ゾーン | 구역 |
| Text note | Tekstnotitie | Текстовая заметка | 文本注释 | テキストメモ | 텍스트 메모 |
| Measure | Meten | Измерить | 测量 | 計測 | 측정 |
| Layers | Lagen | Слои | 图层 | レイヤー | 레이어 |
| Plants in this Design | Planten in dit ontwerp | Растения в этом проекте | 此设计中的植物 | このデザインの植物 | 이 디자인의 식물 |
| Favorites and stamps | Favorieten en stempels | Избранное и штампы | 收藏与图章 | お気に入りとスタンプ | 즐겨찾기와 스탬프 |
| Calendar | Kalender | Календарь | 日历 | カレンダー | 달력 |
| Budget | Budget | Бюджет | 预算 | 予算 | 예산 |
| Design notebook | Ontwerpnotitieboek | Блокнот проектов | 设计笔记本 | デザインノート | 디자인 노트북 |
| Stories | Verhalen | Истории | 故事 | ストーリー | 이야기 |

## Map navigation terms

These arrive with Canvas v2 phases 1 and 2 ([ADR 0015](../adr/0015-rotating-map-and-canvas-controls.md)); they are proposals until those strings land, and each phase confirms them by hand. Turning the view always names the view or the map, so it never reads as the object command Rotate. Map orientation is a PDF setting and never shares a word with the paper Orientation.

| English | fr | es | pt | it | de |
| --- | --- | --- | --- | --- | --- |
| compass | boussole | brújula | bússola | bussola | Kompass |
| Reset north | Rétablir le nord | Restablecer el norte | Redefinir o norte | Ripristina il nord | Nach Norden ausrichten |
| turn the view | tourner la vue | girar la vista | girar a vista | ruotare la vista | Ansicht drehen |
| Map orientation | Orientation de la carte | Orientación del mapa | Orientação do mapa | Orientamento della mappa | Kartenausrichtung |
| North up | Nord en haut | Norte arriba | Norte para cima | Nord in alto | Norden oben |
| As on screen | Comme à l'écran | Como en pantalla | Como na tela | Come sullo schermo | Wie auf dem Bildschirm |
| Pointing device | Périphérique de pointage | Dispositivo señalador | Dispositivo apontador | Dispositivo di puntamento | Zeigegerät |

| English | nl | ru | zh | ja | ko |
| --- | --- | --- | --- | --- | --- |
| compass | kompas | компас | 指南针 | コンパス | 나침반 |
| Reset north | Noorden herstellen | Север вверх | 重置为正北 | 北を上にする | 북쪽을 위로 |
| turn the view | weergave draaien | повернуть вид | 旋转视图 | ビューを回転 | 보기 회전 |
| Map orientation | Kaartoriëntatie | Ориентация карты | 地图方向 | 地図の向き | 지도 방향 |
| North up | Noorden boven | Север вверху | 北向上 | 北を上 | 북쪽 위 |
| As on screen | Zoals op het scherm | Как на экране | 与屏幕一致 | 画面どおり | 화면과 같이 |
| Pointing device | Aanwijsapparaat | Указывающее устройство | 指点设备 | ポインティングデバイス | 포인팅 장치 |
