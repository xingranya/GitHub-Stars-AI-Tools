/// 构建榜单查询所需的日期边界，日期格式为 `YYYY-MM-DD`。
#[derive(Clone, Copy)]
pub struct RankingDateThresholds<'a> {
    pub thirty_days_ago: &'a str,
    pub ninety_days_ago: &'a str,
    pub one_year_ago: &'a str,
}

/// 根据榜单类型生成 GitHub Search 查询式。
pub fn build_global_ranking_query(
    kind: &str,
    language: Option<&str>,
    thresholds: RankingDateThresholds<'_>,
) -> Result<String, String> {
    let mut query = match kind {
        "trending" => format!(
            "stars:>50 archived:false pushed:>={}",
            thresholds.thirty_days_ago
        ),
        "rising" => format!(
            "stars:>10 archived:false created:>={}",
            thresholds.ninety_days_ago
        ),
        "popular" => format!(
            "stars:>1000 archived:false pushed:>={}",
            thresholds.one_year_ago
        ),
        _ => return Err("排行榜类型无效".to_owned()),
    };

    if let Some(raw_language) = language {
        if let Some(language) = normalize_language_qualifier(raw_language)? {
            query.push_str(" language:");
            query.push_str(&language);
        }
    }

    Ok(query)
}

/// 返回个人 Stars 榜单使用的安全 SQL 排序片段。
pub fn personal_ranking_order_clause(kind: &str) -> Result<&'static str, String> {
    match kind {
        "stars" => Ok(
            "r.stars_count DESC, r.starred_at DESC, r.full_name COLLATE NOCASE ASC",
        ),
        "updated" => Ok(
            "CASE WHEN r.pushed_at IS NULL OR TRIM(r.pushed_at) = '' THEN 1 ELSE 0 END, r.pushed_at DESC, r.stars_count DESC",
        ),
        "starred" => Ok("r.starred_at DESC, r.stars_count DESC"),
        _ => Err("个人榜单类型无效".to_owned()),
    }
}

/// 判断排行榜缓存是否仍处于六小时有效期内。
pub fn is_ranking_cache_fresh(fetched_at: i64, now: i64) -> bool {
    const CACHE_TTL_SECONDS: i64 = 6 * 60 * 60;
    now >= fetched_at && now - fetched_at <= CACHE_TTL_SECONDS
}

fn normalize_language_qualifier(language: &str) -> Result<Option<String>, String> {
    let normalized = language.trim();
    if normalized.is_empty() {
        return Ok(None);
    }
    if !normalized.chars().all(|character| {
        character.is_alphanumeric()
            || character.is_whitespace()
            || matches!(character, '+' | '#' | '-' | '.' | '\'')
    }) {
        return Err("GitHub 排行榜语言筛选值无效".to_owned());
    }

    if normalized.chars().any(char::is_whitespace) {
        Ok(Some(format!("\"{normalized}\"")))
    } else {
        Ok(Some(normalized.to_owned()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn thresholds() -> RankingDateThresholds<'static> {
        RankingDateThresholds {
            thirty_days_ago: "2026-06-10",
            ninety_days_ago: "2026-04-11",
            one_year_ago: "2025-07-10",
        }
    }

    #[test]
    fn global_ranking_query_builds_trending_rules() {
        assert_eq!(
            build_global_ranking_query("trending", Some("Rust"), thresholds())
                .expect("趋势榜参数应有效"),
            "stars:>50 archived:false pushed:>=2026-06-10 language:Rust"
        );
    }

    #[test]
    fn global_ranking_query_builds_rising_rules() {
        assert_eq!(
            build_global_ranking_query("rising", None, thresholds()).expect("新锐榜参数应有效"),
            "stars:>10 archived:false created:>=2026-04-11"
        );
    }

    #[test]
    fn global_ranking_query_builds_popular_rules() {
        assert_eq!(
            build_global_ranking_query("popular", Some("TypeScript"), thresholds())
                .expect("热门榜参数应有效"),
            "stars:>1000 archived:false pushed:>=2025-07-10 language:TypeScript"
        );
    }

    #[test]
    fn global_ranking_query_rejects_invalid_kind_and_language() {
        assert!(build_global_ranking_query("daily", None, thresholds()).is_err());
        assert!(
            build_global_ranking_query("trending", Some("Rust sort:forks"), thresholds())
                .expect_err("语言值不能注入额外限定符")
                .contains("语言")
        );
    }

    #[test]
    fn personal_ranking_order_clause_uses_whitelisted_columns() {
        assert_eq!(
            personal_ranking_order_clause("stars").expect("Stars 排序应有效"),
            "r.stars_count DESC, r.starred_at DESC, r.full_name COLLATE NOCASE ASC"
        );
        assert_eq!(
            personal_ranking_order_clause("updated").expect("更新时间排序应有效"),
            "CASE WHEN r.pushed_at IS NULL OR TRIM(r.pushed_at) = '' THEN 1 ELSE 0 END, r.pushed_at DESC, r.stars_count DESC"
        );
        assert_eq!(
            personal_ranking_order_clause("starred").expect("收藏时间排序应有效"),
            "r.starred_at DESC, r.stars_count DESC"
        );
        assert!(personal_ranking_order_clause("random").is_err());
    }

    #[test]
    fn ranking_cache_is_fresh_for_six_hours_only() {
        assert!(is_ranking_cache_fresh(1_000, 1_000 + 6 * 60 * 60));
        assert!(!is_ranking_cache_fresh(1_000, 1_000 + 6 * 60 * 60 + 1));
        assert!(!is_ranking_cache_fresh(2_000, 1_000));
    }
}
