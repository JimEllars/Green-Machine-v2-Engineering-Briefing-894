import sys

def get_lines(filename, start_line, num_lines=150):
    with open(filename, 'r') as f:
        lines = f.readlines()

    start_idx = max(0, start_line - 1)
    end_idx = min(len(lines), start_idx + num_lines)

    for i in range(start_idx, end_idx):
        print(f"{i+1}:{lines[i]}", end="")

if __name__ == "__main__":
    get_lines(sys.argv[1], int(sys.argv[2]))
