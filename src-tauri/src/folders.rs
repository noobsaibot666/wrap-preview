use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::File;
use std::io::Write;
use std::path::{Component, Path};
use zip::write::FileOptions;

const MAX_STRUCTURE_DEPTH: usize = 12;
const MAX_STRUCTURE_NODES: usize = 1000;

#[derive(Deserialize, Serialize, Debug, Clone)]
pub struct FolderNode {
    pub name: String,
    pub r#type: String, // "folder" or "file"
    pub children: Option<Vec<FolderNode>>,
}

pub fn scan_disk_to_structure(path: &Path) -> Result<Vec<FolderNode>, String> {
    let mut node_count = 0usize;
    scan_disk_recursive(path, 1, &mut node_count)
}

fn scan_disk_recursive(
    path: &Path,
    depth: usize,
    node_count: &mut usize,
) -> Result<Vec<FolderNode>, String> {
    if depth > MAX_STRUCTURE_DEPTH {
        return Ok(vec![]); // Stop recursion at limit
    }

    let mut nodes = Vec::new();
    let entries = std::fs::read_dir(path).map_err(|e| format!("Failed to read directory {}: {}", path.display(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        if !entry_path.is_dir() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files/folders (starting with .)
        if name.starts_with('.') {
            continue;
        }

        *node_count += 1;
        if *node_count > MAX_STRUCTURE_NODES {
            break; // Stop scanning if we hit the node limit
        }

        let children = Some(scan_disk_recursive(&entry_path, depth + 1, node_count)?);

        nodes.push(FolderNode {
            name,
            r#type: "folder".to_string(),
            children,
        });
    }

    Ok(nodes)
}

pub fn create_zip_from_structure(
    structure: Vec<FolderNode>,
    output_path: &str,
) -> Result<(), String> {
    validate_structure(&structure)?;
    let file = File::create(output_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Stored)
        .unix_permissions(0o755);

    for node in structure {
        add_node_to_zip(&mut zip, &node, "", &options)?;
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn create_structure_on_disk(structure: Vec<FolderNode>, output_root: &str) -> Result<(), String> {
    validate_structure(&structure)?;
    let root = Path::new(output_root);
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;

    for node in structure {
        add_node_to_disk(&node, root)?;
    }

    Ok(())
}

fn validate_structure(structure: &[FolderNode]) -> Result<(), String> {
    let mut node_count = 0usize;
    validate_sibling_names(structure, "root")?;
    for node in structure {
        validate_node(node, 1, &mut node_count)?;
    }
    Ok(())
}

fn add_node_to_zip<W: Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    node: &FolderNode,
    parent_path: &str,
    options: &FileOptions<()>,
) -> Result<(), String> {
    let name = sanitize_node_name(&node.name)?;
    let current_path = if parent_path.is_empty() {
        name.clone()
    } else {
        format!("{}/{}", parent_path, name)
    };

    if node.r#type == "folder" {
        zip.add_directory(format!("{}/", current_path), *options)
            .map_err(|e| e.to_string())?;
        if let Some(children) = &node.children {
            for child in children {
                add_node_to_zip(zip, child, &current_path, options)?;
            }
        }
    } else {
        zip.start_file(&current_path, *options)
            .map_err(|e| e.to_string())?;
        // For project templates, we could add some default content if needed
        zip.write_all(b"").map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn add_node_to_disk(node: &FolderNode, parent_path: &Path) -> Result<(), String> {
    let name = sanitize_node_name(&node.name)?;
    let current_path = parent_path.join(&name);

    if node.r#type == "folder" {
        std::fs::create_dir_all(&current_path).map_err(|e| e.to_string())?;
        if let Some(children) = &node.children {
            for child in children {
                add_node_to_disk(child, &current_path)?;
            }
        }
    } else {
        if let Some(parent) = current_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        File::create(&current_path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn validate_node(node: &FolderNode, depth: usize, node_count: &mut usize) -> Result<(), String> {
    if depth > MAX_STRUCTURE_DEPTH {
        return Err(format!(
            "Folder structure exceeds the {}-level depth limit",
            MAX_STRUCTURE_DEPTH
        ));
    }
    *node_count += 1;
    if *node_count > MAX_STRUCTURE_NODES {
        return Err(format!(
            "Folder structure exceeds the {} node limit",
            MAX_STRUCTURE_NODES
        ));
    }
    sanitize_node_name(&node.name)?;
    if node.r#type != "folder" && node.r#type != "file" {
        return Err("Folder structure nodes must be either folder or file".to_string());
    }
    if let Some(children) = &node.children {
        validate_sibling_names(children, &node.name)?;
        for child in children {
            validate_node(child, depth + 1, node_count)?;
        }
    }
    Ok(())
}

fn sanitize_node_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Folder node names cannot be empty".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Folder node names must be a single name, not a nested path".to_string());
    }

    let candidate = Path::new(trimmed);
    if candidate.is_absolute() {
        return Err("Absolute paths are not allowed in folder structure nodes".to_string());
    }
    if candidate
        .components()
        .any(|component| {
            matches!(
                component,
                Component::CurDir | Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("Folder structure nodes cannot contain path traversal segments".to_string());
    }
    let mut components = candidate.components();
    match components.next() {
        Some(Component::Normal(_)) if components.next().is_none() => Ok(trimmed.to_string()),
        _ => Err("Folder node names must be a single filesystem segment".to_string()),
    }
}

fn validate_sibling_names(nodes: &[FolderNode], parent_name: &str) -> Result<(), String> {
    let mut seen = HashSet::new();
    for node in nodes {
        let sanitized = sanitize_node_name(&node.name)?;
        let key = sanitized.to_lowercase();
        if !seen.insert(key) {
            return Err(format!(
                "Duplicate node name \"{}\" inside \"{}\"",
                sanitized, parent_name
            ));
        }
    }
    Ok(())
}
