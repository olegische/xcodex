use crate::protocol::ReviewFinding;
use crate::protocol::ReviewOutputEvent;

fn format_location(item: &ReviewFinding) -> String {
    let path = item.code_location.absolute_file_path.display();
    let start = item.code_location.line_range.start;
    let end = item.code_location.line_range.end;
    format!("{path}:{start}-{end}")
}

const REVIEW_FALLBACK_MESSAGE: &str = "Reviewer failed to output a response.";

pub(crate) fn format_review_findings_block(findings: &[ReviewFinding]) -> String {
    let mut lines: Vec<String> = Vec::new();
    lines.push(String::new());
    if findings.len() > 1 {
        lines.push("Full review comments:".to_string());
    } else {
        lines.push("Review comment:".to_string());
    }

    for item in findings {
        lines.push(String::new());
        lines.push(format!("- {} -- {}", item.title, format_location(item)));
        for body_line in item.body.lines() {
            lines.push(format!("  {body_line}"));
        }
    }

    lines.join("\n")
}

pub(crate) fn render_review_output_text(output: &ReviewOutputEvent) -> String {
    let mut sections = Vec::new();
    let explanation = output.overall_explanation.trim();
    if !explanation.is_empty() {
        sections.push(explanation.to_string());
    }
    if !output.findings.is_empty() {
        let findings = format_review_findings_block(&output.findings);
        let trimmed = findings.trim();
        if !trimmed.is_empty() {
            sections.push(trimmed.to_string());
        }
    }
    if sections.is_empty() {
        REVIEW_FALLBACK_MESSAGE.to_string()
    } else {
        sections.join("\n\n")
    }
}
