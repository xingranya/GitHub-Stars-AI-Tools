use sha2::{Digest, Sha256};

pub fn fingerprint<'a>(sources: impl IntoIterator<Item = (&'a str, &'a str)>) -> String {
    let mut sources = sources.into_iter().collect::<Vec<_>>();
    sources.sort_unstable();

    let mut hasher = Sha256::new();
    for (repository_id, source_hash) in sources {
        update_length_prefixed(&mut hasher, repository_id.as_bytes());
        update_length_prefixed(&mut hasher, source_hash.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn update_length_prefixed(hasher: &mut Sha256, value: &[u8]) {
    hasher.update(value.len().to_le_bytes());
    hasher.update(value);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_fingerprint_is_order_independent_and_content_sensitive() {
        let first = fingerprint([("repo-a", "hash-a"), ("repo-b", "hash-b")]);
        let reordered = fingerprint([("repo-b", "hash-b"), ("repo-a", "hash-a")]);
        let changed = fingerprint([("repo-a", "hash-a"), ("repo-b", "hash-c")]);

        assert_eq!(first, reordered);
        assert_ne!(first, changed);
    }
}
