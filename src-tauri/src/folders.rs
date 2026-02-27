use serde::Deserialize;
use std::fs::File;
use std::io::Write;
use zip::write::FileOptions;

#[derive(Deserialize, Debug)]
pub struct FolderNode {
    pub name: String,
    pub r#type: String, // "folder" or "file"
    pub children: Option<Vec<FolderNode>>,
}

pub fn create_zip_from_structure(
    structure: Vec<FolderNode>,
    output_path: &str,
) -> Result<(), String> {
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

fn add_node_to_zip<W: Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    node: &FolderNode,
    parent_path: &str,
    options: &FileOptions<()>,
) -> Result<(), String> {
    let current_path = if parent_path.is_empty() {
        node.name.clone()
    } else {
        format!("{}/{}", parent_path, node.name)
    };

    if node.r#type == "folder" {
        zip.add_directory(&current_path, *options)
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
