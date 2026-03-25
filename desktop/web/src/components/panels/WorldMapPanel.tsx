import { t } from "../../i18n";
import { locale } from "../../state/app";
import { mapLayerVisible, mapStyle } from "../../state/canvas";
import { LocationInput } from "../canvas/LocationInput";
import styles from "./Panels.module.css";

export function WorldMapPanel() {
  void locale.value;

  return (
    <div className={styles.panel}>
      <LocationInput />

      <div className={styles.panelSection}>
        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            checked={mapLayerVisible.value}
            onChange={() => { mapLayerVisible.value = !mapLayerVisible.value }}
          />
          {t("canvas.location.showMap")}
        </label>

        {mapLayerVisible.value && (
          <select
            className={styles.selectInput}
            value={mapStyle.value}
            onChange={(e) => { mapStyle.value = (e.target as HTMLSelectElement).value as 'street' | 'terrain' }}
          >
            <option value="street">{t("canvas.location.mapStreet")}</option>
            <option value="terrain">{t("canvas.location.mapTerrain")}</option>
          </select>
        )}
      </div>
    </div>
  );
}
