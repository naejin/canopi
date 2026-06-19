use common_types::saved_object_stamps::SavedObjectStamp;

use crate::db::{self, UserDb};

pub fn create_saved_object_stamp(
    user_db: &UserDb,
    name: String,
    payload_json: String,
) -> Result<SavedObjectStamp, String> {
    let conn = db::acquire(&user_db.0, "UserDb");
    crate::db::user_db::create_saved_object_stamp(&conn, &name, &payload_json)
        .map(row_to_saved_object_stamp)
        .map_err(|e| format!("Failed to create Saved Object Stamp '{name}': {e}"))
}

pub fn get_saved_object_stamps(user_db: &UserDb) -> Result<Vec<SavedObjectStamp>, String> {
    let conn = db::acquire(&user_db.0, "UserDb");
    crate::db::user_db::get_saved_object_stamps(&conn)
        .map(|rows| rows.into_iter().map(row_to_saved_object_stamp).collect())
        .map_err(|e| format!("Failed to read Saved Object Stamps: {e}"))
}

fn row_to_saved_object_stamp(row: crate::db::user_db::SavedObjectStampRow) -> SavedObjectStamp {
    SavedObjectStamp {
        id: row.id,
        name: row.name,
        payload_json: row.payload_json,
        sort_order: row.sort_order,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

#[cfg(test)]
mod tests {
    use crate::db::{self, UserDb};
    use std::sync::Mutex;

    fn test_user_db() -> UserDb {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        db::user_db::init(&conn).unwrap();
        UserDb(Mutex::new(conn))
    }

    #[test]
    fn creates_and_lists_saved_object_stamps() {
        let user_db = test_user_db();

        let saved = super::create_saved_object_stamp(
            &user_db,
            "Apple guild".to_owned(),
            r#"{"plants":[{"id":"plant-1"}],"zones":[],"annotations":[],"groups":[]}"#.to_owned(),
        )
        .unwrap();

        let stamps = super::get_saved_object_stamps(&user_db).unwrap();

        assert_eq!(saved.name, "Apple guild");
        assert_eq!(stamps, vec![saved]);
    }
}
